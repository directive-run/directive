/**
 * Copied from 1.35 (packages/core/src/core/module.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

import type {
  CrossModuleConstraintsDef,
  CrossModuleDeps,
  CrossModuleDerivationsDef,
  CrossModuleEffectsDef,
  CrossModuleFactsWithSelf,
  CrossModuleResolversDef,
  DefinitionMeta,
  EffectsDef,
  Facts,
  InferDerivations,
  InferFacts,
  ModuleHooks,
  ModuleSchema,
  TypedConstraintsDef,
  TypedDerivationsDef,
  TypedEventsDef,
  TypedResolversDef,
} from "./index.js";
import type { SourcesDef } from "./sources.js";

// ============================================================================
// Module Configuration
// ============================================================================

/**
 * Module configuration with consolidated schema.
 *
 * derive and events are optional - omit them if your schema has empty derivations/events.
 */
export interface ModuleConfig<M extends ModuleSchema> {
  schema: M;
  init?: (facts: Facts<M["facts"]>) => void;
  derive?: TypedDerivationsDef<M>;
  events?: TypedEventsDef<M>;
  /**
   * Fire-and-forget side effects.
   *
   * `deps` on one of these may name a fact key **or** one of this module's
   * derivations — the second parameter is what makes the derivation IDs
   * available to the type, and it matches what the runtime accepts. The third
   * types the `derived` argument `run()` receives, so an effect can read a
   * derivation as a value rather than only name it as a dependency.
   */
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
  sources?: SourcesDef<Readonly<InferFacts<M>>>;
  constraints?: TypedConstraintsDef<M>;
  resolvers?: TypedResolversDef<M>;
  hooks?: ModuleHooks<M>;
  /** Optional metadata for debugging and devtools (never read on hot path). */
  meta?: DefinitionMeta;
  /** History configuration — controls which events create snapshots for undo/redo. */
  history?: {
    /** Events that create history snapshots. Omit to snapshot all events. */
    snapshotEvents?: Array<
      keyof (M["events"] extends Record<string, unknown>
        ? M["events"]
        : Record<string, never>) &
        string
    >;
  };
}

/**
 * Module configuration with cross-module dependencies for type-safe access
 * to other modules' facts in effects and constraints.
 *
 * When crossModuleDeps is provided:
 * - Own module facts: `facts.self.*`
 * - Cross-module facts: `facts.{dep}.*`
 *
 * @example
 * ```typescript
 * import { authSchema } from './auth';
 * import { dataSchema } from './data';
 *
 * const uiModule = createModule("ui", {
 *   schema: uiSchema,
 *   crossModuleDeps: { auth: authSchema, data: dataSchema },
 *   effects: {
 *     onAuthChange: {
 *       run: (facts) => {
 *         facts.self.notifications   // ✅ own module via "self"
 *         facts.auth.isAuthenticated // ✅ cross-module (namespaced)
 *         facts.data.users           // ✅ cross-module (namespaced)
 *       }
 *     }
 *   },
 *   constraints: {
 *     fetchWhenAuth: {
 *       when: (facts) => facts.auth.isAuthenticated && facts.self.users.length === 0,
 *       require: { type: "FETCH_USERS" },
 *     }
 *   }
 * });
 * ```
 */
export interface ModuleConfigWithDeps<
  M extends ModuleSchema,
  Deps extends CrossModuleDeps,
> {
  schema: M;
  /**
   * Cross-module dependencies for type-safe access in derive/effects/constraints.
   *
   * **Access patterns by context:**
   * - `derive`, `effects`, `constraints`: Use `facts.self.*` for own module, `facts.{dep}.*` for cross-module
   * - `init`, `events`: Use flat access (`facts.myFact`) - no cross-module access
   * - `resolvers`: flat `ctx.facts.myFact` for own facts, read-only `ctx.deps.{dep}.*` for dependencies
   * - `sources` gates (`key` / `active`): same as constraints, read-only
   *
   * This separation ensures initialization and event handling stay scoped to own module,
   * while observers (derive/effects/constraints) can see across modules.
   *
   * @example
   * ```typescript
   * crossModuleDeps: { auth: authSchema },
   * init: (facts) => { facts.users = []; },              // flat access
   * derive: { count: (facts) => facts.self.users.length }, // facts.self.*
   * effects: { log: { run: (facts) => console.log(facts.auth.token) } }, // facts.{dep}.*
   * ```
   */
  crossModuleDeps: Deps;
  /** Initialize module facts. Uses flat access (`facts.myFact`) to ensure modules initialize independently. */
  init?: (facts: Facts<M["facts"]>) => void;
  /** Derivations with cross-module facts access (`facts.self.*` + `facts.{dep}.*`) */
  derive?: CrossModuleDerivationsDef<M, Deps>;
  /** Event handlers. Uses flat access (`facts.myFact`) to keep mutations scoped to own module. */
  events?: TypedEventsDef<M>;
  /** Effects with cross-module facts access (`facts.self.*` + `facts.{dep}.*`) */
  effects?: CrossModuleEffectsDef<M, Deps>;
  /**
   * Typed external event sources. `publish` dispatches this module's own
   * events. A `key` / `active` gate reads facts like a constraint does:
   * `facts.self.*` for own facts, `facts.{dep}.*` for declared deps.
   */
  sources?: SourcesDef<Readonly<CrossModuleFactsWithSelf<M, Deps>>>;
  /** Constraints with cross-module facts access (`facts.self.*` + `facts.{dep}.*`) */
  constraints?: CrossModuleConstraintsDef<M, Deps>;
  /**
   * Resolvers. `ctx.facts` is flat access to the module's own facts
   * (`ctx.facts.myFact`); declared dependencies are read through read-only
   * `ctx.deps.{dep}.*`. To change another module's state, emit a requirement
   * or dispatch an event that module owns.
   */
  resolvers?: CrossModuleResolversDef<M, Deps>;
  hooks?: ModuleHooks<M>;
  /** Optional metadata for debugging and devtools (never read on hot path). */
  meta?: DefinitionMeta;
  /** History configuration — controls which events create snapshots for undo/redo. */
  history?: {
    /** Events that create history snapshots. Omit to snapshot all events. */
    snapshotEvents?: Array<
      keyof (M["events"] extends Record<string, unknown>
        ? M["events"]
        : Record<string, never>) &
        string
    >;
  };
}
