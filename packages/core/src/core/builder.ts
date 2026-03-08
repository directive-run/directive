/**
 * Builder Pattern API for Directive Modules
 *
 * An alternative, fluent API for creating modules that provides
 * a more declarative style for module definition.
 *
 * @example
 * ```typescript
 * import { module, t } from '@directive-run/core';
 *
 * const counter = module("counter")
 *   .schema({
 *     facts: { count: t.number(), lastAction: t.string() },
 *     derivations: { doubled: t.number(), isPositive: t.boolean() },
 *     events: { increment: {}, decrement: {} },
 *     requirements: {},
 *   })
 *   .init((facts) => {
 *     facts.count = 0;
 *     facts.lastAction = "";
 *   })
 *   .derive({
 *     doubled: (facts) => facts.count * 2,
 *     isPositive: (facts) => facts.count > 0,
 *   })
 *   .events({
 *     increment: (facts) => {
 *       facts.count += 1;
 *       facts.lastAction = "increment";
 *     },
 *     decrement: (facts) => {
 *       facts.count -= 1;
 *       facts.lastAction = "decrement";
 *     },
 *   })
 *   .build();
 * ```
 */

import type {
  DerivationsSchema,
  EffectsDef,
  Facts,
  ModuleDef,
  ModuleHooks,
  ModuleSchema,
} from "./types.js";

// ============================================================================
// Builder Types
// ============================================================================

/**
 * Fluent builder interface for constructing {@link ModuleDef} instances step by step.
 *
 * Chain methods like `.schema()`, `.init()`, `.derive()`, `.events()`, and others
 * to configure the module, then call `.build()` to produce the final definition.
 * The builder validates that all schema-declared derivations and events have
 * corresponding implementations before returning.
 *
 * @typeParam M - The module schema type, narrowed after calling `.schema()`.
 * @public
 */
export interface ModuleBuilder<M extends ModuleSchema = ModuleSchema> {
  /**
   * Define the schema for this module (facts, derivations, events, requirements).
   */
  schema<NewM extends ModuleSchema>(schema: NewM): ModuleBuilder<NewM>;

  /**
   * Define the initialization function for this module.
   */
  init(initFn: (facts: Facts<M["facts"]>) => void): ModuleBuilder<M>;

  /**
   * Define derivation implementations for this module.
   * Keys must match those declared in schema.derivations.
   */
  derive<
    D extends Record<
      string,
      (facts: Facts<M["facts"]>, derived: DeriveAccessor<M>) => unknown
    >,
  >(derivations: D): ModuleBuilder<M>;

  /**
   * Define event handler implementations for this module.
   * Keys must match those declared in schema.events.
   */
  events<
    E extends Record<
      string,
      (facts: Facts<M["facts"]>, payload: unknown) => void
    >,
  >(events: E): ModuleBuilder<M>;

  /**
   * Define effects (side effects) for this module.
   */
  effects(effects: EffectsDef<M["facts"]>): ModuleBuilder<M>;

  /**
   * Define constraints for this module.
   */
  constraints<C extends Record<string, ConstraintDef<M>>>(
    constraints: C,
  ): ModuleBuilder<M>;

  /**
   * Define resolvers for this module.
   */
  resolvers<R extends Record<string, ResolverDef<M>>>(
    resolvers: R,
  ): ModuleBuilder<M>;

  /**
   * Define lifecycle hooks for this module.
   */
  hooks(hooks: ModuleHooks<M>): ModuleBuilder<M>;

  /**
   * Build the module definition.
   */
  build(): ModuleDef<M>;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Accessor for reading other derivations within a derivation function.
 */
type DeriveAccessor<M extends ModuleSchema> =
  M["derivations"] extends DerivationsSchema
    ? {
        readonly [K in keyof M["derivations"]]: InferSchemaType<
          M["derivations"][K]
        >;
      }
    : Record<string, never>;

/**
 * Infer the TypeScript type from a schema type definition.
 */
// biome-ignore lint/suspicious/noExplicitAny: Type inference utility
type InferSchemaType<T> = T extends { _type: infer U } ? U : any;

/**
 * Constraint definition for the builder.
 */
interface ConstraintDef<M extends ModuleSchema> {
  when: (facts: Facts<M["facts"]>) => boolean;
  require:
    | { type: string; [key: string]: unknown }
    | ((
        facts: Facts<M["facts"]>,
      ) => { type: string; [key: string]: unknown } | null);
  priority?: number;
}

/**
 * Resolver definition for the builder.
 */
interface ResolverDef<M extends ModuleSchema> {
  requirement:
    | string
    | ((req: { type: string; [key: string]: unknown }) => boolean);
  resolve: (
    req: { type: string; [key: string]: unknown },
    ctx: { facts: Facts<M["facts"]>; signal?: AbortSignal },
  ) => void | Promise<void>;
  retry?: {
    attempts?: number;
    backoff?: "linear" | "exponential";
    delay?: number;
  };
  timeout?: number;
  key?: (req: { type: string; [key: string]: unknown }) => string;
}

// ============================================================================
// Builder Implementation
// ============================================================================

/**
 * Create a new module using the fluent builder pattern.
 *
 * Returns a {@link ModuleBuilder} that lets you declaratively define a module's
 * schema, initialization, derivations, events, effects, constraints, resolvers,
 * and lifecycle hooks via method chaining. Call `.build()` at the end to produce
 * the final {@link ModuleDef}.
 *
 * @remarks
 * The builder validates at build time that every derivation and event declared
 * in the schema has a corresponding implementation. Missing implementations
 * cause a descriptive error.
 *
 * @param id - Unique identifier for this module, used for namespacing in multi-module systems.
 * @returns A {@link ModuleBuilder} ready for configuration via method chaining.
 *
 * @example
 * ```typescript
 * import { module, t } from '@directive-run/core';
 *
 * const counter = module("counter")
 *   .schema({
 *     facts: { count: t.number() },
 *     derivations: { doubled: t.number() },
 *     events: { increment: {} },
 *     requirements: {},
 *   })
 *   .init((facts) => {
 *     facts.count = 0;
 *   })
 *   .derive({
 *     doubled: (facts) => facts.count * 2,
 *   })
 *   .events({
 *     increment: (facts) => {
 *       facts.count += 1;
 *     },
 *   })
 *   .build();
 * ```
 *
 * @public
 */
export function module(id: string): ModuleBuilder<ModuleSchema> {
  // Internal state for building the module
  // biome-ignore lint/suspicious/noExplicitAny: Internal state needs flexibility
  let _schema: any = {
    facts: {},
    derivations: {},
    events: {},
    requirements: {},
  };
  // biome-ignore lint/suspicious/noExplicitAny: Internal state needs flexibility
  let _init: any;
  // biome-ignore lint/suspicious/noExplicitAny: Internal state needs flexibility
  let _events: any;
  // biome-ignore lint/suspicious/noExplicitAny: Internal state needs flexibility
  let _derive: any;
  // biome-ignore lint/suspicious/noExplicitAny: Internal state needs flexibility
  let _effects: any;
  // biome-ignore lint/suspicious/noExplicitAny: Internal state needs flexibility
  let _constraints: any;
  // biome-ignore lint/suspicious/noExplicitAny: Internal state needs flexibility
  let _resolvers: any;
  // biome-ignore lint/suspicious/noExplicitAny: Internal state needs flexibility
  let _hooks: any;

  // biome-ignore lint/suspicious/noExplicitAny: Builder needs flexibility for fluent API
  const builder: ModuleBuilder<any> = {
    schema(schema) {
      _schema = schema;
      return builder;
    },

    init(initFn) {
      _init = initFn;
      return builder;
    },

    derive(derivations) {
      _derive = derivations;
      return builder;
    },

    events(events) {
      _events = events;
      return builder;
    },

    effects(effects) {
      _effects = effects;
      return builder;
    },

    constraints(constraints) {
      _constraints = constraints;
      return builder;
    },

    resolvers(resolvers) {
      _resolvers = resolvers;
      return builder;
    },

    hooks(hooks) {
      _hooks = hooks;
      return builder;
    },

    build() {
      // Validate schema is defined
      if (!_schema || !_schema.facts) {
        throw new Error(
          `[Directive] Module "${id}" requires a schema with at least facts defined. ` +
            "Call .schema({ facts: { ... } }) before .build().",
        );
      }

      // Validate derivations match schema
      const schemaDerivationKeys = Object.keys(_schema.derivations ?? {});
      const deriveKeys = Object.keys(_derive ?? {});
      const missingDerives = schemaDerivationKeys.filter(
        (k) => !deriveKeys.includes(k),
      );
      if (missingDerives.length > 0) {
        throw new Error(
          `[Directive] Module "${id}" is missing derivation implementations: ${missingDerives.join(", ")}. ` +
            "All derivations declared in schema.derivations must have implementations in .derive().",
        );
      }

      // Validate events match schema
      const schemaEventKeys = Object.keys(_schema.events ?? {});
      const eventKeys = Object.keys(_events ?? {});
      const missingEvents = schemaEventKeys.filter(
        (k) => !eventKeys.includes(k),
      );
      if (missingEvents.length > 0) {
        throw new Error(
          `[Directive] Module "${id}" is missing event handler implementations: ${missingEvents.join(", ")}. ` +
            "All events declared in schema.events must have implementations in .events().",
        );
      }

      return {
        id,
        schema: _schema,
        init: _init,
        events: _events,
        derive: _derive,
        effects: _effects,
        constraints: _constraints,
        resolvers: _resolvers,
        hooks: _hooks,
      };
    },
  };

  return builder;
}
