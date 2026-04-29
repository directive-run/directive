/**
 * Module - The declarative API for defining Directive modules
 *
 * Modules group related facts, constraints, resolvers, effects, and derivations.
 */

import isDevelopment from "#is-development";
import type {
  CrossModuleConstraintsDef,
  CrossModuleDeps,
  CrossModuleDerivationsDef,
  CrossModuleEffectsDef,
  DefinitionMeta,
  EffectsDef,
  Facts,
  ModuleDef,
  ModuleHooks,
  ModuleSchema,
  TypedConstraintsDef,
  TypedDerivationsDef,
  TypedEventsDef,
  TypedResolversDef,
} from "./types.js";

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
  effects?: EffectsDef<M["facts"]>;
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
   * - `init`, `events`, `resolvers`: Use flat access (`facts.myFact`) - no cross-module access
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
  /** Constraints with cross-module facts access (`facts.self.*` + `facts.{dep}.*`) */
  constraints?: CrossModuleConstraintsDef<M, Deps>;
  /** Resolvers. Uses flat access (`ctx.facts.myFact`) to keep async mutations scoped to own module. */
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

// ============================================================================
// Module Validation Helpers (dev-mode only)
// ============================================================================

/** Validate module ID follows naming conventions */
function validateModuleId(id: string): void {
  if (!id || typeof id !== "string") {
    console.warn("[Directive] Module ID must be a non-empty string");

    return;
  }
  if (!/^(__[a-z][a-z0-9_-]*|[a-z][a-z0-9-]*)$/i.test(id)) {
    console.warn(
      `[Directive] Module ID "${id}" should follow kebab-case convention (e.g., "my-module")`,
    );
  }
}

/** Warn when keys in `implKeys` are missing from `schemaKeys` and vice versa */
function validateKeyAlignment(
  implKeys: Set<string>,
  schemaKeys: Set<string>,
  implLabel: string,
  schemaLabel: string,
  missingImplMessage: string,
): void {
  for (const key of implKeys) {
    if (!schemaKeys.has(key)) {
      console.warn(
        `[Directive] ${implLabel} "${key}" not declared in ${schemaLabel}`,
      );
    }
  }
  for (const key of schemaKeys) {
    if (!implKeys.has(key)) {
      console.warn(
        `[Directive] ${schemaLabel}["${key}"] ${missingImplMessage}`,
      );
    }
  }
}

/** Validate history.snapshotEvents reference valid event names */
function validateSnapshotEvents(
  snapshotEvents: string[],
  schemaEvents: Record<string, unknown>,
): void {
  if (snapshotEvents.length === 0) {
    console.warn(
      "[Directive] history.snapshotEvents is an empty array — no events will create history snapshots. " +
        "Omit history.snapshotEvents entirely to snapshot all events, or list specific events.",
    );
  }
  const schemaEventKeys = new Set(Object.keys(schemaEvents));
  for (const eventName of snapshotEvents) {
    if (!schemaEventKeys.has(eventName)) {
      console.warn(
        `[Directive] history.snapshotEvents entry "${eventName}" not declared in schema.events. ` +
          `Available events: ${[...schemaEventKeys].join(", ") || "(none)"}`,
      );
    }
  }
}

/** Validate resolvers reference valid requirement types */
function validateResolverRequirements(
  resolvers: Record<string, unknown>,
  requirements: Record<string, unknown>,
): void {
  const requirementTypes = new Set(Object.keys(requirements));
  for (const [resolverName, resolver] of Object.entries(resolvers)) {
    const resolverDef = resolver as { requirement?: string };
    if (
      typeof resolverDef.requirement === "string" &&
      !requirementTypes.has(resolverDef.requirement)
    ) {
      console.warn(
        `[Directive] Resolver "${resolverName}" references unknown requirement type "${resolverDef.requirement}". ` +
          `Available types: ${[...requirementTypes].join(", ") || "(none)"}`,
      );
    }
  }
}

/** Run all dev-mode validations for a module config */
function validateModuleConfig<M extends ModuleSchema>(
  id: string,
  config: ModuleConfig<M> | ModuleConfigWithDeps<M, CrossModuleDeps>,
): void {
  validateModuleId(id);

  if (!config.schema) {
    console.warn("[Directive] Module schema is required");
  } else if (!config.schema.facts) {
    console.warn("[Directive] Module schema.facts is required");
  }

  validateKeyAlignment(
    new Set(Object.keys(config.derive ?? {})),
    new Set(Object.keys(config.schema?.derivations ?? {})),
    "Derivation",
    "schema.derivations",
    "has no matching implementation in derive",
  );

  validateKeyAlignment(
    new Set(Object.keys(config.events ?? {})),
    new Set(Object.keys(config.schema?.events ?? {})),
    "Event",
    "schema.events",
    "has no matching handler in events",
  );

  if (config.history?.snapshotEvents) {
    validateSnapshotEvents(
      config.history.snapshotEvents as string[],
      config.schema?.events ?? {},
    );
  }

  if (config.resolvers && config.schema?.requirements) {
    validateResolverRequirements(
      config.resolvers as Record<string, unknown>,
      config.schema.requirements,
    );
  }
}

// ============================================================================
// createModule
// ============================================================================

/**
 * Create a module definition with full type inference.
 *
 * The consolidated schema provides:
 * - Derivation composition (`derived.otherDerivation` is typed)
 * - Event dispatch (`system.dispatch({ type: "..." })` has autocomplete)
 * - Resolver requirements (`req.payload` is typed based on requirement type)
 *
 * @param id - Unique module identifier (kebab-case recommended)
 * @param config - Module configuration including schema, init, derive, constraints, resolvers, etc.
 * @returns A frozen module definition ready for use with `createSystem`
 *
 * @example
 * ```ts
 * const trafficLight = createModule("traffic-light", {
 *   schema: {
 *     facts: {
 *       phase: t.string<"red" | "green" | "yellow">(),
 *       elapsed: t.number(),
 *     },
 *     derivations: {
 *       isRed: t.boolean(),
 *       timeRemaining: t.number(),
 *     },
 *     events: {
 *       tick: {},
 *       setPhase: { phase: t.string<"red" | "green" | "yellow">() },
 *     },
 *     requirements: {
 *       TRANSITION: { to: t.string<"red" | "green" | "yellow">() },
 *     },
 *   },
 *   init: (facts) => {
 *     facts.phase = "red";
 *     facts.elapsed = 0;
 *   },
 *   derive: {
 *     isRed: (facts) => facts.phase === "red",
 *     timeRemaining: (facts, derived) => {
 *       // derived.isRed is typed as boolean!
 *       return derived.isRed ? 30 - facts.elapsed : 0;
 *     },
 *   },
 *   events: {
 *     tick: (facts) => { facts.elapsed += 1; },
 *     setPhase: (facts, { phase }) => { facts.phase = phase; }, // phase is typed!
 *   },
 *   constraints: {
 *     shouldTransition: {
 *       when: (facts) => facts.phase === "red" && facts.elapsed > 30,
 *       require: { type: "TRANSITION", to: "green" },
 *     },
 *   },
 *   resolvers: {
 *     transition: {
 *       requirement: "TRANSITION",
 *       resolve: async (req, ctx) => {
 *         ctx.facts.phase = req.to; // req.to is typed!
 *         ctx.facts.elapsed = 0;
 *       },
 *     },
 *   },
 *   hooks: {
 *     // Optional: observe resolver failures owned by this module.
 *     // Fires AFTER retries are exhausted and the engine has handled the error
 *     // (error boundary, plugin emit, retry decision). Use it as a side-channel
 *     // observer for module-local logging/telemetry — not for recovery.
 *     onResolverError: (error, requirement, ctx) => {
 *       console.warn(`[traffic-light] resolver failed for ${requirement.type}`, error);
 *     },
 *   },
 * });
 * ```
 *
 * @example With cross-module dependencies
 * ```ts
 * import { authSchema } from './auth';
 *
 * const dataModule = createModule("data", {
 *   schema: dataSchema,
 *   crossModuleDeps: { auth: authSchema },
 *   constraints: {
 *     fetchWhenAuth: {
 *       when: (facts) => {
 *         // facts.self.* for own module, facts.auth.* for cross-module
 *         return facts.auth.isAuthenticated && facts.self.users.length === 0;
 *       },
 *       require: { type: "FETCH_USERS" },
 *     },
 *   },
 *   derive: {
 *     canFetch: (facts) => facts.auth.isAuthenticated && facts.self.users.length === 0,
 *   },
 * });
 * ```
 *
 * @public
 */
// Overload 1: With crossModuleDeps
export function createModule<
  const M extends ModuleSchema,
  const Deps extends CrossModuleDeps,
>(id: string, config: ModuleConfigWithDeps<M, Deps>): ModuleDef<M>;

// Overload 2: Without crossModuleDeps (original signature)
export function createModule<const M extends ModuleSchema>(
  id: string,
  config: ModuleConfig<M>,
): ModuleDef<M>;

// Overload 3: Union (used by createModuleFactory)
export function createModule<const M extends ModuleSchema>(
  id: string,
  config: ModuleConfigWithDeps<M, CrossModuleDeps> | ModuleConfig<M>,
): ModuleDef<M>;

/** @internal Implementation overload — see public overloads above. */
export function createModule<const M extends ModuleSchema>(
  id: string,
  config: ModuleConfig<M> | ModuleConfigWithDeps<M, CrossModuleDeps>,
): ModuleDef<M> {
  if (isDevelopment) {
    validateModuleConfig(id, config);
  }

  // Extract crossModuleDeps if present (for runtime proxy creation)
  const crossModuleDeps =
    "crossModuleDeps" in config ? config.crossModuleDeps : undefined;

  return {
    id,
    schema: config.schema,
    init: config.init,
    // Cast to TypedDerivationsDef for ModuleDef compatibility (runtime handles both types)
    derive: (config.derive ?? {}) as TypedDerivationsDef<M>,
    events: config.events ?? ({} as TypedEventsDef<M>),
    effects: config.effects as EffectsDef<M["facts"]> | undefined,
    constraints: config.constraints as TypedConstraintsDef<M> | undefined,
    resolvers: config.resolvers,
    hooks: config.hooks,
    meta: config.meta,
    history: config.history,
    // Store crossModuleDeps for runtime proxy creation
    crossModuleDeps: crossModuleDeps as CrossModuleDeps | undefined,
  };
}

/**
 * Create a module factory that produces named instances from a single definition.
 * Useful for multi-instance UIs (tabs, panels, multi-tenant) where you need
 * isolated state from the same schema.
 *
 * @param config - Module configuration (same shape as `createModule` minus the `id`)
 * @returns A factory function that accepts a name and returns a `ModuleDef`
 *
 * @example
 * ```typescript
 * const chatRoom = createModuleFactory({
 *   schema: {
 *     facts: { messages: t.array<string>(), users: t.array<string>() },
 *     derivations: { count: t.number() },
 *   },
 *   init: (facts) => { facts.messages = []; facts.users = []; },
 *   derive: { count: (facts) => facts.messages.length },
 * });
 *
 * const system = createSystem({
 *   modules: {
 *     lobby: chatRoom("lobby"),
 *     support: chatRoom("support"),
 *   },
 * });
 * ```
 *
 * @public
 */
export function createModuleFactory<const M extends ModuleSchema>(
  config: ModuleConfig<M>,
): (name: string) => ModuleDef<M>;
export function createModuleFactory<
  const M extends ModuleSchema,
  const Deps extends CrossModuleDeps,
>(config: ModuleConfigWithDeps<M, Deps>): (name: string) => ModuleDef<M>;
/** @internal Implementation overload — see public overloads above. */
export function createModuleFactory<const M extends ModuleSchema>(
  config: ModuleConfig<M> | ModuleConfigWithDeps<M, CrossModuleDeps>,
): (name: string) => ModuleDef<M> {
  // Pass config directly — createModule's implementation overload handles both types.
  // Do NOT cast to ModuleConfig<M> which would strip crossModuleDeps.
  return (name: string) => createModule(name, config);
}
