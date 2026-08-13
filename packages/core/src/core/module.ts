/**
 * Module - The declarative API for defining Directive modules
 *
 * Modules group related facts, constraints, resolvers, effects, and derivations.
 */

import isDevelopment from "#is-development";
import { BLOCKED_PROPS, DERIVATION_DEP_PREFIX } from "./tracking.js";
import type {
  CrossModuleConstraintsDef,
  CrossModuleDeps,
  CrossModuleDerivationsDef,
  CrossModuleEffectsDef,
  DefinitionMeta,
  EffectsDef,
  Facts,
  InferDerivations,
  ModuleDef,
  ModuleHooks,
  ModuleSchema,
  TypedConstraintsDef,
  TypedDerivationsDef,
  TypedEventsDef,
  TypedResolversDef,
} from "./types.js";
import type { SourcesDef } from "./types/sources.js";

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
  sources?: SourcesDef;
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
  /**
   * Typed external event sources. Cross-module modules use the same
   * primitive — sources never access facts, so they are not affected by
   * the `facts.self.*` / `facts.{dep}.*` namespace split.
   */
  sources?: SourcesDef;
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

/**
 * Throw when a module's fact key conflicts with a reserved namespace pivot
 * or evaluation alias used by the data-form predicate runtime. Two classes:
 *
 * - The cross-module namespace pivots — `self` and every declared
 *   `crossModuleDeps` namespace. A fact named after a pivot would make
 *   `prefixPredicateSpec` mis-route the pivot's nested predicate against
 *   the pivot's namespace instead of treating it as a literal fact lookup.
 * - The evaluation aliases `prev` and `current` — reserved for the
 *   previous/live snapshot scopes (`$changed`, clobber baselines). A fact
 *   with one of these names would shadow the alias in those scopes.
 *
 * Thrown unconditionally — this is a structural integrity check, not a dev
 * convenience. Production users running into this would otherwise see silent
 * mis-routing.
 */
function validatePivotNameConflicts<M extends ModuleSchema>(
  id: string,
  config: ModuleConfig<M> | ModuleConfigWithDeps<M, CrossModuleDeps>,
): void {
  const facts = (config.schema?.facts ?? {}) as Record<string, unknown>;
  const factKeys = Object.keys(facts);
  if (factKeys.length === 0) {
    return;
  }
  const reserved = new Set<string>(["self", "prev", "current"]);
  const deps =
    "crossModuleDeps" in config && config.crossModuleDeps
      ? Object.keys(config.crossModuleDeps as Record<string, unknown>)
      : [];
  for (const depName of deps) {
    reserved.add(depName);
  }
  for (const key of factKeys) {
    if (reserved.has(key)) {
      throw new Error(
        `[Directive] module '${id}': fact key '${key}' conflicts with a reserved namespace pivot or evaluation alias (self / prev / current / a crossModuleDep namespace). Three fixes:\n  1. Rename the fact (e.g. ${key}_)\n  2. Remove '${key}' from this module's crossModuleDeps if it's not actually needed\n  3. Move the fact under a wrapping namespace (t.object({ inner: ... }))`,
      );
    }
  }
}

/**
 * Reject constraint `abortOn` entries that name a reserved property — a
 * `BLOCKED_PROPS` key (`__proto__`, `constructor`, `prototype`) or a
 * `$`-prefixed key. Such names can never be valid fact slots, so the
 * clobber-detection binding would silently no-op. A structural integrity
 * check — runs unconditionally, not just in dev.
 */
function validateAbortOnKeys<M extends ModuleSchema>(
  id: string,
  config: ModuleConfig<M> | ModuleConfigWithDeps<M, CrossModuleDeps>,
): void {
  const constraints = config.constraints as
    | Record<string, { abortOn?: readonly string[] }>
    | undefined;
  if (!constraints) {
    return;
  }
  for (const [cid, constraint] of Object.entries(constraints)) {
    const abortOn = constraint?.abortOn;
    if (!abortOn) {
      continue;
    }
    for (const key of abortOn) {
      if (BLOCKED_PROPS.has(key) || key.startsWith("$")) {
        throw new Error(
          `[Directive] module '${id}' constraint '${cid}': abortOn key '${key}' is reserved (BLOCKED_PROPS or $-prefixed)`,
        );
      }
    }
  }
}

/**
 * Reject constraint `bind:` entries that name a reserved property — a
 * `BLOCKED_PROPS` key (`__proto__`, `constructor`, `prototype`) or a
 * `$`-prefixed key. Same defensive shape as {@link validateAbortOnKeys}.
 *
 * `bind:` is the v2 reservation slot for single-writer binding (RFC-0003
 * Future Work). The engine does not consume it yet — but the validator
 * ships now so the symmetry is locked in code review before any v2
 * runtime wires the field. Without this gate, a future engine could
 * silently accept `bind: ['__proto__']` and the reserved-key bypass
 * (the exact class of bug `validateAbortOnKeys` exists to close) would
 * re-appear on the sibling field. Symmetric structural integrity
 * check — runs unconditionally, not just in dev.
 */
function validateBindKeys<M extends ModuleSchema>(
  id: string,
  config: ModuleConfig<M> | ModuleConfigWithDeps<M, CrossModuleDeps>,
): void {
  const constraints = config.constraints as
    | Record<string, { bind?: readonly string[] }>
    | undefined;
  if (!constraints) {
    return;
  }
  for (const [cid, constraint] of Object.entries(constraints)) {
    const bind = constraint?.bind;
    if (!bind) {
      continue;
    }
    for (const key of bind) {
      if (BLOCKED_PROPS.has(key) || key.startsWith("$")) {
        throw new Error(
          `[Directive] module '${id}' constraint '${cid}': bind key '${key}' is reserved (BLOCKED_PROPS or $-prefixed)`,
        );
      }
    }
  }
}

/**
 * Reject fact keys and derivation IDs that carry the dependency-set separator.
 *
 * A tracked dependency set is one flat `Set<string>` holding both fact keys and
 * derivation IDs, and {@link DERIVATION_DEP_PREFIX} is what keeps the two apart:
 * a derivation is recorded as the separator followed by its ID, a fact as its
 * key verbatim. That namespace is only injective while no fact key begins with
 * the separator. One that does is byte-identical to the recorded form of the
 * derivation named by the rest of the key — so writing that fact invalidates
 * everything that reads the same-named derivation, and a trace renders the fact
 * as `derive.<name>`. Exactly the collision the separator was introduced to
 * eliminate, displaced by one character.
 *
 * The original comment on that constant argued a control character could not
 * appear in a property name written in source. It can: a bracketed access with
 * a unicode escape is ordinary TypeScript, and a schema key can be computed
 * rather than written. So the property has to be enforced, and this is where.
 *
 * The separator is rejected anywhere in the name, not just in front. Only a
 * leading one collides today, but the character has no legitimate use in an
 * identifier, and a narrower rule would leave the next reader to work out why
 * position matters.
 *
 * Thrown unconditionally — a wrong invalidation set is not a dev-mode concern,
 * and the alternative to throwing is the silent mis-invalidation above.
 */
function validateDepNamespaceKeys<M extends ModuleSchema>(
  id: string,
  config: ModuleConfig<M> | ModuleConfigWithDeps<M, CrossModuleDeps>,
): void {
  const check = (name: string, what: string): void => {
    if (!name.includes(DERIVATION_DEP_PREFIX)) {
      return;
    }

    throw new Error(
      `[Directive] module '${id}': ${what} '${JSON.stringify(name)}' contains U+001F (unit separator). That character separates derivation IDs from fact keys inside a dependency set, so a name carrying it makes the two indistinguishable — writing the fact would invalidate readers of a same-named derivation. Rename it to something without control characters.`,
    );
  };

  for (const key of Object.keys(config.schema?.facts ?? {})) {
    check(key, "fact key");
  }
  for (const key of Object.keys(config.derive ?? {})) {
    check(key, "derivation");
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
    // Detect the canonical footgun: user passed bare facts as `schema`.
    // Every `t.X()` output carries a `_typeName` property — if we see one
    // directly under `schema`, that's almost certainly an intended fact
    // declaration in the wrong position.
    const looksLikeFlatSchema = Object.values(
      config.schema as Record<string, unknown>,
    ).some(
      (v) => v != null && typeof v === "object" && "_typeName" in (v as object),
    );
    if (looksLikeFlatSchema) {
      console.warn(
        `[Directive] Module "${id}" schema appears to contain fact declarations directly. Did you mean \`schema: { facts: { ... } }\` instead of \`schema: { ... }\`?`,
      );
    }
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
  // Pivot-name conflicts are a structural integrity check, not a dev
  // convenience — run unconditionally.
  validatePivotNameConflicts(id, config);

  // Reserved `abortOn` keys would silently disable clobber-detection — a
  // structural integrity check, run unconditionally.
  validateAbortOnKeys(id, config);

  // `bind:` is type-reserved for v2 single-writer binding. The validator
  // ships now (vacuously safe today, since the engine never reads
  // `def.bind`) so the symmetry with abortOn is locked in code review
  // before any v2 runtime wires the field.
  validateBindKeys(id, config);

  // The dependency-set separator is only a namespace while nothing else uses
  // it. Enforced unconditionally — a name that carries it produces a wrong
  // invalidation set, silently.
  validateDepNamespaceKeys(id, config);

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
    effects: config.effects as
      | EffectsDef<M["facts"], keyof M["derivations"] & string>
      | undefined,
    sources: (config as { sources?: SourcesDef }).sources,
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
