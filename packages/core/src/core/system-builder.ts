/**
 * System Builder API
 *
 * Fluent builder for creating Directive systems.
 *
 * @example Single module
 * ```typescript
 * import { system } from '@directive-run/core';
 *
 * const sys = system()
 *   .module(counterModule)
 *   .plugins([loggingPlugin()])
 *   .debug({ timeTravel: true })
 *   .build();
 * ```
 *
 * @example Multiple modules
 * ```typescript
 * const sys = system()
 *   .modules({ auth: authModule, cart: cartModule })
 *   .plugins([loggingPlugin()])
 *   .build();
 * ```
 */

import { createSystem } from "./system.js";
import type {
  DebugConfig,
  ErrorBoundaryConfig,
  ExtractSchema,
  InferFacts,
  ModuleDef,
  ModuleSchema,
  ModulesMap,
  NamespacedSystem,
  Plugin,
  SingleModuleSystem,
} from "./types.js";

// ============================================================================
// Builder Types
// ============================================================================

/**
 * Entry point of the system builder, returned by {@link system}.
 *
 * Choose `.module()` for a single-module {@link SingleModuleSystem} with direct
 * fact/derivation access, or `.modules()` for a namespaced {@link NamespacedSystem}
 * that composes multiple modules.
 *
 * @public
 */
export interface SystemBuilderStart {
  /**
   * Configure the system with a single module definition.
   *
   * @param mod - The module definition to use as the system's sole module.
   * @returns A {@link SingleModuleSystemBuilder} for further configuration.
   */
  module<S extends ModuleSchema>(
    mod: ModuleDef<S>,
  ): SingleModuleSystemBuilder<S>;

  /**
   * Configure the system with multiple named modules.
   *
   * @param mods - A map of namespace keys to module definitions.
   * @returns A {@link NamespacedSystemBuilder} for further configuration.
   */
  modules<const Modules extends ModulesMap>(
    mods: Modules,
  ): NamespacedSystemBuilder<Modules>;
}

/**
 * Builder for a single-module system with direct access to facts, derivations, and events.
 *
 * @remarks
 * Use this builder when your system contains exactly one module. The resulting
 * {@link SingleModuleSystem} exposes facts, derivations, and dispatch without
 * namespace prefixes.
 *
 * @typeParam S - The module schema type.
 * @public
 */
export interface SingleModuleSystemBuilder<S extends ModuleSchema> {
  /** Register plugins that hook into system lifecycle events. */
  plugins(plugins: Array<Plugin<ModuleSchema>>): SingleModuleSystemBuilder<S>;
  /** Enable debug features such as time-travel debugging and snapshot limits. */
  debug(config: DebugConfig): SingleModuleSystemBuilder<S>;
  /** Configure error boundary behavior including recovery strategies. */
  errorBoundary(config: ErrorBoundaryConfig): SingleModuleSystemBuilder<S>;
  /** Set the reconciliation tick interval in milliseconds. */
  tickMs(ms: number): SingleModuleSystemBuilder<S>;
  /** Enable zero-config mode which auto-generates constraints from schema metadata. */
  zeroConfig(enabled?: boolean): SingleModuleSystemBuilder<S>;
  /** Provide initial fact values to hydrate the system on startup. */
  initialFacts(facts: Partial<InferFacts<S>>): SingleModuleSystemBuilder<S>;
  /** Finalize configuration and create the running {@link SingleModuleSystem}. */
  build(): SingleModuleSystem<S>;
}

/**
 * Builder for a namespaced multi-module system.
 *
 * @remarks
 * Use this builder when composing multiple modules. The resulting
 * {@link NamespacedSystem} prefixes facts and derivations with the module
 * namespace key (e.g., `system.facts.auth.token`).
 *
 * @typeParam Modules - The modules map type mapping namespace keys to module definitions.
 * @public
 */
export interface NamespacedSystemBuilder<Modules extends ModulesMap> {
  /** Register plugins that hook into system lifecycle events. */
  plugins(
    plugins: Array<Plugin<ModuleSchema>>,
  ): NamespacedSystemBuilder<Modules>;
  /** Enable debug features such as time-travel debugging and snapshot limits. */
  debug(config: DebugConfig): NamespacedSystemBuilder<Modules>;
  /** Configure error boundary behavior including recovery strategies. */
  errorBoundary(config: ErrorBoundaryConfig): NamespacedSystemBuilder<Modules>;
  /** Set the reconciliation tick interval in milliseconds. */
  tickMs(ms: number): NamespacedSystemBuilder<Modules>;
  /** Enable zero-config mode which auto-generates constraints from schema metadata. */
  zeroConfig(enabled?: boolean): NamespacedSystemBuilder<Modules>;
  /** Provide initial fact values keyed by module namespace for hydration on startup. */
  initialFacts(
    facts: Partial<{
      [K in keyof Modules]: Partial<InferFacts<ExtractSchema<Modules[K]>>>;
    }>,
  ): NamespacedSystemBuilder<Modules>;
  /** Control the order in which modules are initialized: automatic, declaration order, or explicit. */
  initOrder(
    order: "auto" | "declaration" | Array<keyof Modules & string>,
  ): NamespacedSystemBuilder<Modules>;
  /** Finalize configuration and create the running {@link NamespacedSystem}. */
  build(): NamespacedSystem<Modules>;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a Directive system using the fluent builder pattern.
 *
 * Returns a {@link SystemBuilderStart} that branches into either a
 * single-module path (`.module()`) or a namespaced multi-module path
 * (`.modules()`). Chain configuration methods like `.plugins()`, `.debug()`,
 * and `.errorBoundary()`, then call `.build()` to produce the running system.
 *
 * @remarks
 * This is a convenience wrapper around {@link createSystem}. Both produce
 * identical systems; the builder simply offers a more discoverable,
 * chainable API.
 *
 * @returns A {@link SystemBuilderStart} ready to receive a module or modules map.
 *
 * @example Single-module system
 * ```typescript
 * import { system } from '@directive-run/core';
 *
 * const sys = system()
 *   .module(counterModule)
 *   .plugins([loggingPlugin()])
 *   .debug({ timeTravel: true })
 *   .build();
 * ```
 *
 * @example Multi-module namespaced system
 * ```typescript
 * import { system } from '@directive-run/core';
 *
 * const sys = system()
 *   .modules({ auth: authModule, cart: cartModule })
 *   .plugins([loggingPlugin()])
 *   .initOrder(["auth", "cart"])
 *   .build();
 * ```
 *
 * @public
 */
export function system(): SystemBuilderStart {
  return {
    module<S extends ModuleSchema>(
      mod: ModuleDef<S>,
    ): SingleModuleSystemBuilder<S> {
      return createSingleBuilder<S>(mod);
    },
    modules<const Modules extends ModulesMap>(
      mods: Modules,
    ): NamespacedSystemBuilder<Modules> {
      return createNamespacedBuilder<Modules>(mods);
    },
  };
}

function createSingleBuilder<S extends ModuleSchema>(
  mod: ModuleDef<S>,
): SingleModuleSystemBuilder<S> {
  let _plugins: Array<Plugin<ModuleSchema>> | undefined;
  let _debug: DebugConfig | undefined;
  let _errorBoundary: ErrorBoundaryConfig | undefined;
  let _tickMs: number | undefined;
  let _zeroConfig: boolean | undefined;
  let _initialFacts: Partial<InferFacts<S>> | undefined;

  const builder: SingleModuleSystemBuilder<S> = {
    plugins(plugins) {
      _plugins = plugins;
      return builder;
    },
    debug(config) {
      _debug = config;
      return builder;
    },
    errorBoundary(config) {
      _errorBoundary = config;
      return builder;
    },
    tickMs(ms) {
      _tickMs = ms;
      return builder;
    },
    zeroConfig(enabled = true) {
      _zeroConfig = enabled;
      return builder;
    },
    initialFacts(facts) {
      _initialFacts = facts;
      return builder;
    },
    build(): SingleModuleSystem<S> {
      return createSystem<S>({
        module: mod,
        plugins: _plugins,
        debug: _debug,
        errorBoundary: _errorBoundary,
        tickMs: _tickMs,
        zeroConfig: _zeroConfig,
        initialFacts: _initialFacts,
      });
    },
  };

  return builder;
}

function createNamespacedBuilder<Modules extends ModulesMap>(
  mods: Modules,
): NamespacedSystemBuilder<Modules> {
  let _plugins: Array<Plugin<ModuleSchema>> | undefined;
  let _debug: DebugConfig | undefined;
  let _errorBoundary: ErrorBoundaryConfig | undefined;
  let _tickMs: number | undefined;
  let _zeroConfig: boolean | undefined;
  // biome-ignore lint/suspicious/noExplicitAny: Partial namespaced facts typing
  let _initialFacts: any;
  let _initOrder:
    | "auto"
    | "declaration"
    | Array<keyof Modules & string>
    | undefined;

  const builder: NamespacedSystemBuilder<Modules> = {
    plugins(plugins) {
      _plugins = plugins;
      return builder;
    },
    debug(config) {
      _debug = config;
      return builder;
    },
    errorBoundary(config) {
      _errorBoundary = config;
      return builder;
    },
    tickMs(ms) {
      _tickMs = ms;
      return builder;
    },
    zeroConfig(enabled = true) {
      _zeroConfig = enabled;
      return builder;
    },
    initialFacts(facts) {
      _initialFacts = facts;
      return builder;
    },
    initOrder(order) {
      _initOrder = order;
      return builder;
    },
    build(): NamespacedSystem<Modules> {
      return createSystem<Modules>({
        modules: mods,
        plugins: _plugins,
        debug: _debug,
        errorBoundary: _errorBoundary,
        tickMs: _tickMs,
        zeroConfig: _zeroConfig,
        initialFacts: _initialFacts,
        initOrder: _initOrder,
      });
    },
  };

  return builder;
}
