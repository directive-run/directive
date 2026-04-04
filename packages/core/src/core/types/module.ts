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
  BatchConfig,
  BatchResolveResults,
  RetryPolicy,
} from "./resolvers.js";
import type {
  DerivationsSchema,
  EventsSchema,
  InferDerivations,
  InferEventPayloadFromSchema,
  InferRequirementPayloadFromSchema,
  InferRequirements,
  InferSchemaType,
  ModuleSchema,
  RequirementsSchema,
} from "./schema.js";
import type { System } from "./system.js";

// ============================================================================
// Module Hooks
// ============================================================================

/** Lifecycle hooks for modules */
export interface ModuleHooks<_M extends ModuleSchema> {
  // biome-ignore lint/suspicious/noExplicitAny: System type inference is complex
  onInit?: (system: System<any>) => void;
  // biome-ignore lint/suspicious/noExplicitAny: System type inference is complex
  onStart?: (system: System<any>) => void;
  // biome-ignore lint/suspicious/noExplicitAny: System type inference is complex
  onStop?: (system: System<any>) => void;
  onError?: (error: DirectiveError, context: unknown) => void;
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
export type TypedDerivationsDef<M extends ModuleSchema> = {
  [K in keyof GetDerivationsSchema<M>]:
    | TypedDerivationFn<M, K>
    | { compute: TypedDerivationFn<M, K>; meta?: DefinitionMeta };
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
    | { handler: TypedEventHandlerFn<M, K>; meta?: DefinitionMeta };
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
  /** Condition function */
  when: (facts: Facts<M["facts"]>) => boolean | Promise<boolean>;
  /**
   * Requirement(s) to produce when condition is met.
   */
  require:
    | RequirementOutput<InferRequirements<M>>
    | ((facts: Facts<M["facts"]>) => RequirementOutput<InferRequirements<M>>);
  /** Timeout for async constraints (ms) */
  timeout?: number;
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
  /** Condition function with cross-module facts access */
  when: (
    facts: CrossModuleFactsWithSelf<M, Deps>,
  ) => boolean | Promise<boolean>;
  /**
   * Requirement(s) to produce when condition is met.
   */
  require:
    | RequirementOutput<InferRequirements<M>>
    | ((
        facts: CrossModuleFactsWithSelf<M, Deps>,
      ) => RequirementOutput<InferRequirements<M>>);
  /** Timeout for async constraints (ms) */
  timeout?: number;
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
  /** Effect function with cross-module facts access. Return a cleanup function for teardown. */
  run: (
    facts: CrossModuleFactsWithSelf<M, Deps>,
    prev: CrossModuleFactsWithSelf<M, Deps> | undefined,
    // biome-ignore lint/suspicious/noConfusingVoidType: void semantics needed for implicit no-return
  ) => void | EffectCleanup | Promise<void | EffectCleanup>;
  /** Optional dependency keys to filter when effect runs */
  deps?: string[];
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
    | { compute: CrossModuleDerivationFn<M, Deps, K>; meta?: DefinitionMeta };
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
  /** Custom key function for deduplication */
  key?: (req: ExtractRequirement<M, T>) => string;
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
  effects?: EffectsDef<M["facts"]>;
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
