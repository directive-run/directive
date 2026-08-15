/**
 * Module Types - Type definitions for modules with consolidated schema
 */

import type {
  CrossModuleDeps,
  CrossModuleFactsWithSelf,
} from "./composition.js";
import type { EffectCleanup, EffectsDef } from "./effects.js";
import type { DirectiveError } from "./errors.js";
import type { Facts, FactsSnapshot } from "./facts.js";
import type { DefinitionMeta } from "./meta.js";
import type {
  FactPredicate,
  FactTemplate,
  KeySelector,
  PatchSpec,
} from "./predicate.js";
import type {
  BatchConfig,
  BatchResolveResults,
  RetryPolicy,
} from "./resolvers.js";
import type {
  DerivationsSchema,
  EventsSchema,
  InferDerivations,
  InferEventPayloadFromSchema,
  InferFacts,
  InferRequirementPayloadFromSchema,
  InferRequirements,
  InferSchemaType,
  ModuleSchema,
  RequirementsSchema,
} from "./schema.js";
import type { SourcesDef } from "./sources.js";
import type { System } from "./system.js";

// ============================================================================
// Module Hooks
// ============================================================================

/** Lifecycle hooks for modules */
export interface ModuleHooks<M extends ModuleSchema> {
  onInit?: (system: System<any>) => void;
  onStart?: (system: System<any>) => void;
  onStop?: (system: System<any>) => void;
  onError?: (error: DirectiveError, context: unknown) => void;
  /**
   * Called when a resolver owned by this module throws after all retries
   * have been exhausted. The hook fires *after* the engine's internal error
   * handling (error boundary, plugin notification, retry decision) so it is
   * a side-channel observer — not a recovery mechanism.
   *
   * Use it to forward resolver failures into module-local error sinks
   * (logging, telemetry, user-facing toast machines) without coupling those
   * sinks to the engine's plugin system.
   *
   * **Failure isolation:** Errors thrown from inside `onResolverError` are
   * caught by the engine and logged via `console.error`; they do not abort
   * the engine or other modules' hooks.
   *
   * @param error - The error the resolver threw (already normalized to `Error`).
   * @param requirement - The requirement object that the failing resolver was handling.
   * @param context - Hook context, including a typed snapshot of this module's facts.
   */
  onResolverError?: (
    error: Error,
    requirement: { type: string; [key: string]: unknown },
    ctx: { facts: Facts<M["facts"]> },
  ) => void;
}

// ============================================================================
// Typed Derivations Definition
// ============================================================================

/** Helper to get derivations schema, defaulting to empty */
type GetDerivationsSchema<M extends ModuleSchema> =
  M["derivations"] extends DerivationsSchema
    ? M["derivations"]
    : Record<string, never>;

/** Helper to get events schema, defaulting to empty */
type GetEventsSchema<M extends ModuleSchema> = M["events"] extends EventsSchema
  ? M["events"]
  : Record<string, never>;

/** Helper to get requirements schema, defaulting to empty */
type GetRequirementsSchema<M extends ModuleSchema> =
  M["requirements"] extends RequirementsSchema
    ? M["requirements"]
    : Record<string, never>;

/**
 * Derivation function with typed facts and derive accessor.
 * The derive accessor is typed from schema.derivations.
 * Supports both t.*() builders and type assertion {} as {} patterns.
 */
export type TypedDerivationFn<
  M extends ModuleSchema,
  K extends keyof GetDerivationsSchema<M>,
> = (
  facts: Facts<M["facts"]>,
  derived: InferDerivations<M>,
) => InferSchemaType<GetDerivationsSchema<M>[K]>;

/**
 * Typed derivations definition using the module schema.
 * Each derivation key must match schema.derivations and return the declared type.
 */
type TypedDerivationT<
  M extends ModuleSchema,
  K extends keyof GetDerivationsSchema<M>,
> = InferSchemaType<GetDerivationsSchema<M>[K]>;

export type TypedDerivationsDef<M extends ModuleSchema> = {
  [K in keyof GetDerivationsSchema<M>]:
    | TypedDerivationFn<M, K>
    | {
        compute:
          | TypedDerivationFn<M, K>
          | ([TypedDerivationT<M, K>] extends [boolean]
              ? FactPredicate<InferFacts<M>>
              : never)
          | ([TypedDerivationT<M, K>] extends [string] ? FactTemplate : never);
        meta?: DefinitionMeta;
      };
};

// ============================================================================
// Typed Events Definition
// ============================================================================

/**
 * Event handler function with typed facts and payload.
 * Payload is typed from schema.events[K].
 */
export type TypedEventHandlerFn<
  M extends ModuleSchema,
  K extends keyof GetEventsSchema<M>,
> = keyof GetEventsSchema<M>[K] extends never
  ? (facts: Facts<M["facts"]>) => void
  : (
      facts: Facts<M["facts"]>,
      payload: InferEventPayloadFromSchema<GetEventsSchema<M>[K]>,
    ) => void;

/**
 * Typed events definition using the module schema.
 * Each event key must match schema.events with the correct payload type.
 */
export type TypedEventsDef<M extends ModuleSchema> = {
  [K in keyof GetEventsSchema<M>]:
    | TypedEventHandlerFn<M, K>
    | { handler: TypedEventHandlerFn<M, K>; meta?: DefinitionMeta }
    | {
        /**
         * Declarative event body: assigns facts from literals, payload
         * fields ({@link KeySelector}), or interpolated strings
         * ({@link FactTemplate}). Use instead of `handler` for simple
         * "set facts from event payload" events.
         */
        patch: PatchSpec<
          InferFacts<M>,
          InferEventPayloadFromSchema<GetEventsSchema<M>[K]>
        >;
        meta?: DefinitionMeta;
      };
};

// ============================================================================
// Typed Constraints Definition
// ============================================================================

/**
 * Requirement output from a constraint.
 */
export type RequirementOutput<R> = R | R[] | null;

/**
 * Constraint definition with typed requirements.
 */
export interface TypedConstraintDef<M extends ModuleSchema> {
  /** Priority for ordering (higher runs first) */
  priority?: number;
  /** Mark this constraint as async */
  async?: boolean;
  /**
   * Condition the constraint requires. Either a function (sync or async)
   * `(facts, derived) => boolean`, or a declarative {@link FactPredicate} spec
   * (e.g. `{ phase: "red", elapsed: { $gte: 30 } }`).
   *
   * `derived` is this module's own derivations, in the same position a
   * derivation body receives them. Gate on it directly — reaching back through
   * `system.derive` works in a single-module system and silently resolves a
   * namespace once the module is composed with others.
   */
  when:
    | ((
        facts: Facts<M["facts"]>,
        derived: InferDerivations<M>,
      ) => boolean | Promise<boolean>)
    | FactPredicate<InferFacts<M>>;
  /**
   * Requirement(s) to produce when condition is met.
   *
   * Receives `derived` as its second argument, same as `when`.
   */
  require:
    | RequirementOutput<InferRequirements<M>>
    | ((
        facts: Facts<M["facts"]>,
        derived: InferDerivations<M>,
      ) => RequirementOutput<InferRequirements<M>>);
  /** Timeout for async constraints (ms) */
  timeout?: number;
  /**
   * Fact keys this resolver aborts on when they change mid-flight. The
   * engine snapshots their values at resolver dispatch; if any of them
   * changes before the resolver writes, the resolver's writes are
   * dropped and the resolver aborted. Omit for no binding (default).
   * Ignored on async constraints.
   */
  abortOn?: readonly string[];
  /**
   * Constraint IDs whose resolvers must complete before this constraint is evaluated.
   * If a dependency's `when()` returns false (no requirements), this constraint proceeds.
   * If a dependency's resolver fails, this constraint remains blocked.
   * Cross-module: use "moduleName::constraintName" format (after references are not auto-prefixed).
   */
  after?: string[];
  /**
   * Explicit fact dependencies for this constraint.
   * Required for async constraints to enable dependency tracking.
   */
  deps?: string[];
  /** Optional metadata for debugging and devtools (never read on hot path). */
  meta?: DefinitionMeta;
}

/**
 * Typed constraints definition using the module schema.
 */
export type TypedConstraintsDef<M extends ModuleSchema> = Record<
  string,
  TypedConstraintDef<M>
>;

// ============================================================================
// Cross-Module Typed Definitions (for modules with crossModuleDeps)
// ============================================================================

/**
 * Constraint definition with cross-module typed facts.
 * Used when a module declares crossModuleDeps for type-safe access to other modules.
 *
 * At runtime, constraints receive facts with:
 * - `facts.self.*` for own module's facts
 * - `facts.{dep}.*` for cross-module facts
 */
export interface CrossModuleConstraintDef<
  M extends ModuleSchema,
  Deps extends CrossModuleDeps,
> {
  /** Priority for ordering (higher runs first) */
  priority?: number;
  /** Mark this constraint as async */
  async?: boolean;
  /**
   * Condition the constraint requires. Either a function (sync or async)
   * with cross-module facts access, or a nested {@link FactPredicate}:
   * `{ self: { phase: "red" }, auth: { token: { $exists: true } } }`.
   */
  when:
    | ((
        facts: CrossModuleFactsWithSelf<M, Deps>,
        derived: InferDerivations<M>,
      ) => boolean | Promise<boolean>)
    | FactPredicate<CrossModuleFactsWithSelf<M, Deps>>;
  /**
   * Requirement(s) to produce when condition is met.
   *
   * Receives `derived` as its second argument, same as `when`.
   */
  require:
    | RequirementOutput<InferRequirements<M>>
    | ((
        facts: CrossModuleFactsWithSelf<M, Deps>,
        derived: InferDerivations<M>,
      ) => RequirementOutput<InferRequirements<M>>);
  /** Timeout for async constraints (ms) */
  timeout?: number;
  /**
   * Fact keys this resolver aborts on when they change mid-flight. The
   * engine snapshots their values at resolver dispatch; if any of them
   * changes before the resolver writes, the resolver's writes are
   * dropped and the resolver aborted. Omit for no binding (default).
   * Ignored on async constraints.
   */
  abortOn?: readonly string[];
  /**
   * Constraint IDs whose resolvers must complete before this constraint is evaluated.
   * If a dependency's `when()` returns false (no requirements), this constraint proceeds.
   * If a dependency's resolver fails, this constraint remains blocked.
   * Cross-module: use "moduleName::constraintName" format (after references are not auto-prefixed).
   */
  after?: string[];
  /**
   * Explicit fact dependencies for this constraint.
   * Required for async constraints to enable dependency tracking.
   */
  deps?: string[];
  /** Optional metadata for debugging and devtools (never read on hot path). */
  meta?: DefinitionMeta;
}

/**
 * Cross-module constraints definition.
 */
export type CrossModuleConstraintsDef<
  M extends ModuleSchema,
  Deps extends CrossModuleDeps,
> = Record<string, CrossModuleConstraintDef<M, Deps>>;

/**
 * Effect definition with cross-module typed facts.
 * Used when a module declares crossModuleDeps for type-safe access to other modules.
 *
 * At runtime, effects receive facts with:
 * - `facts.self.*` for own module's facts
 * - `facts.{dep}.*` for cross-module facts
 */
export interface CrossModuleEffectDef<
  M extends ModuleSchema,
  Deps extends CrossModuleDeps,
> {
  /**
   * Effect function with cross-module facts access. Return a cleanup function
   * for teardown.
   *
   * `prevFacts` is the fact snapshot from before this pass — the same shape as
   * `facts`, or absent on the first run. Named for what it holds: `facts` and
   * `prevFacts` sat side by side and only one of them said.
   *
   * There is deliberately no `prevDerived`. Derivations are computed from
   * facts, and the runtime keeps a previous snapshot of the facts only, so a
   * previous derived value would have to be recomputed rather than recalled —
   * from `prevFacts`, which the caller already has.
   *
   * `derived` is this module's own derivations — read it rather than reaching
   * back through `system.derive`, which resolves a namespace in a composed
   * system. Third, because `facts` and `prevFacts` hold the first two positions.
   */
  run: (
    facts: CrossModuleFactsWithSelf<M, Deps>,
    prevFacts: CrossModuleFactsWithSelf<M, Deps> | undefined,
    derived: InferDerivations<M>,
    // biome-ignore lint/suspicious/noConfusingVoidType: void semantics needed for implicit no-return
  ) => void | EffectCleanup | Promise<void | EffectCleanup>;
  /**
   * Optional dependency keys to filter when effect runs. Fact keys and
   * derivation IDs both; the runtime resolves which a name is when the effect
   * is considered.
   */
  deps?: string[];
  /**
   * Optional declarative trigger — a {@link FactPredicate} that gates whether
   * `run()` fires. Mutually exclusive with `deps`.
   */
  on?: FactPredicate<CrossModuleFactsWithSelf<M, Deps>>;
  /** Optional metadata for debugging and devtools (never read on hot path). */
  meta?: DefinitionMeta;
}

/**
 * Cross-module effects definition.
 */
export type CrossModuleEffectsDef<
  M extends ModuleSchema,
  Deps extends CrossModuleDeps,
> = Record<string, CrossModuleEffectDef<M, Deps>>;

/**
 * Derivation function with cross-module typed facts.
 * Used when a module declares crossModuleDeps for type-safe access to other modules' facts.
 *
 * At runtime, derivations receive facts with:
 * - `facts.self.*` for own module's facts
 * - `facts.{dep}.*` for cross-module facts (read-only)
 */
export type CrossModuleDerivationFn<
  M extends ModuleSchema,
  Deps extends CrossModuleDeps,
  K extends keyof GetDerivationsSchema<M>,
> = (
  facts: CrossModuleFactsWithSelf<M, Deps>,
  derived: InferDerivations<M>,
) => InferSchemaType<GetDerivationsSchema<M>[K]>;

/**
 * Cross-module derivations definition.
 */
export type CrossModuleDerivationsDef<
  M extends ModuleSchema,
  Deps extends CrossModuleDeps,
> = {
  [K in keyof GetDerivationsSchema<M>]:
    | CrossModuleDerivationFn<M, Deps, K>
    | {
        compute:
          | CrossModuleDerivationFn<M, Deps, K>
          | ([TypedDerivationT<M, K>] extends [boolean]
              ? FactPredicate<CrossModuleFactsWithSelf<M, Deps>>
              : never)
          | ([TypedDerivationT<M, K>] extends [string] ? FactTemplate : never);
        meta?: DefinitionMeta;
      };
};

// ============================================================================
// Typed Resolvers Definition
// ============================================================================

/**
 * Resolver context with typed facts.
 */
export interface TypedResolverContext<M extends ModuleSchema> {
  readonly facts: Facts<M["facts"]>;
  readonly signal: AbortSignal;
  /** Returns a read-only snapshot of the current facts state, useful for before/after comparisons inside resolvers. */
  readonly snapshot: () => FactsSnapshot<M["facts"]>;
  /**
   * Mark this resolver's owning requirement(s) as eligible for re-evaluation
   * in the next reconciliation pass — even if the constraint that produced
   * them re-emits the same requirement ID.
   *
   * See {@link ResolverContext.requeue} for full semantics and guidance on
   * when (and when not) to use this. The default behavior — silently
   * suppressing same-constraint re-fires — is intentional and prevents
   * accidental loops; `requeue()` is the explicit opt-in for chained
   * pipelines.
   *
   * @example
   * ```typescript
   * resolve: async (req, ctx) => {
   *   if (ctx.facts.pendingAction?.kind === "first") {
   *     await doFirst();
   *     ctx.facts.pendingAction = { kind: "second" };
   *     ctx.requeue();
   *     return;
   *   }
   *   await doSecond();
   *   ctx.facts.status = "done";
   * }
   * ```
   */
  readonly requeue: () => void;
}

/**
 * Helper to extract a specific requirement type from the schema.
 */
type ExtractRequirement<
  M extends ModuleSchema,
  T extends keyof GetRequirementsSchema<M>,
> = { type: T } & InferRequirementPayloadFromSchema<
  GetRequirementsSchema<M>[T]
>;

/**
 * Typed resolver definition for a specific requirement type.
 */
export interface TypedResolverDef<
  M extends ModuleSchema,
  T extends keyof GetRequirementsSchema<M> & string,
> {
  /** Requirement type to handle */
  requirement: T;
  /**
   * Custom dedup key. Either a `(req) => string` function, or a
   * {@link KeySelector} array of requirement-payload field names
   * (`["type", "to"]`) that builds a stable key from those fields.
   */
  key?:
    | ((req: ExtractRequirement<M, T>) => string)
    | KeySelector<ExtractRequirement<M, T>>;
  /** Retry policy */
  retry?: RetryPolicy;
  /** Timeout for resolver execution (ms) */
  timeout?: number;
  /** Batch configuration */
  batch?: BatchConfig;
  /** Resolve function for single requirement */
  resolve?: (
    req: ExtractRequirement<M, T>,
    ctx: TypedResolverContext<M>,
  ) => Promise<void>;
  /** Resolve batched requirements as a group (all-or-nothing). Receives the full array collected during the batch window. If this throws, all items in the batch are considered failed. */
  resolveBatch?: (
    reqs: ExtractRequirement<M, T>[],
    ctx: TypedResolverContext<M>,
  ) => Promise<void>;
  /** Resolve batched requirements with per-item success/failure results. Return a `BatchResolveResults` array in the same order as the input. Failed items can be individually retried. */
  resolveBatchWithResults?: (
    reqs: ExtractRequirement<M, T>[],
    ctx: TypedResolverContext<M>,
  ) => Promise<BatchResolveResults>;
  /** Optional metadata for debugging and devtools (never read on hot path). */
  meta?: DefinitionMeta;
}

/**
 * Union of all typed resolver definitions for all requirement types.
 */
type AnyTypedResolverDef<M extends ModuleSchema> = {
  [T in keyof GetRequirementsSchema<M> & string]: TypedResolverDef<M, T>;
}[keyof GetRequirementsSchema<M> & string];

/**
 * Typed resolvers definition using the module schema.
 */
export type TypedResolversDef<M extends ModuleSchema> = Record<
  string,
  AnyTypedResolverDef<M>
>;

// ============================================================================
// Module Definition
// ============================================================================

/**
 * Module definition using consolidated schema.
 * This provides full type inference for all module components.
 *
 * derive and events are optional when the schema has no derivations/events.
 */
export interface ModuleDef<M extends ModuleSchema = ModuleSchema> {
  id: string;
  schema: M;
  init?: (facts: Facts<M["facts"]>) => void;
  derive?: TypedDerivationsDef<M>;
  events?: TypedEventsDef<M>;
  effects?: EffectsDef<
    M["facts"],
    keyof M["derivations"] & string,
    InferDerivations<M>
  >;
  /**
   * Typed external event sources. See {@link SourceDef} for the primitive's
   * lifecycle + rationale. Each source attaches at `system.start()` and
   * tears down at `system.stop()`. Use for Supabase realtime channels,
   * WebSocket message streams, polling timers, browser event listeners —
   * any inbound external event the module needs to map into its own event
   * dispatch surface.
   */
  sources?: SourcesDef;
  constraints?: TypedConstraintsDef<M>;
  resolvers?: TypedResolversDef<M>;
  hooks?: ModuleHooks<M>;
  /** Optional metadata for debugging and devtools (never read on hot path). */
  meta?: DefinitionMeta;
  /**
   * History configuration for this module.
   * Controls which events create snapshots for undo/redo.
   */
  history?: {
    /**
     * Events that create history snapshots.
     * If omitted, ALL events create snapshots (default).
     * If provided, only listed events create snapshots for undo/redo.
     */
    snapshotEvents?: Array<keyof GetEventsSchema<M> & string>;
  };
  /**
   * Cross-module dependencies (runtime marker).
   * When present, constraints/effects receive `facts.self.*` + `facts.{dep}.*`.
   * @internal
   */
  crossModuleDeps?: CrossModuleDeps;
}
