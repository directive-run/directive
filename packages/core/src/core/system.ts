/**
 * System - The top-level API for creating a Directive runtime
 *
 * A system combines modules with plugins and configuration.
 * Modules are passed as an object with namespaced access:
 *
 * @example
 * ```typescript
 * const system = createSystem({
 *   modules: { auth: authModule, data: dataModule },
 * });
 *
 * system.facts.auth.token       // Namespaced facts
 * system.derive.data.userCount  // Namespaced derivations
 * system.events.auth.login()    // Namespaced events
 * ```
 */

import { isPrototypeSafe } from "../utils/utils.js";
import { createEngine } from "./engine.js";
import { BLOCKED_PROPS } from "./tracking.js";
import type {
  CreateSystemOptionsNamed,
  CreateSystemOptionsSingle,
  ModuleDef,
  ModuleSchema,
  ModulesMap,
  NamespacedSystem,
  SingleModuleSystem,
} from "./types.js";

/** Namespace separator for internal key prefixing (e.g., "auth::token") */
const SEPARATOR = "::";

// ============================================================================
// Topological Sort for Module Dependencies
// ============================================================================

/**
 * Perform topological sort on modules based on crossModuleDeps.
 * Returns module namespaces in dependency order (dependencies first).
 *
 * @throws Error if circular dependency detected
 */
function topologicalSort<Modules extends ModulesMap>(
  modulesMap: Modules,
): Array<keyof Modules & string> {
  const namespaces = Object.keys(modulesMap) as Array<keyof Modules & string>;
  const visited = new Set<string>();
  const visiting = new Set<string>(); // For cycle detection
  const result: Array<keyof Modules & string> = [];
  const path: string[] = []; // Reuse array to avoid O(n²) memory

  function visit(namespace: string): void {
    if (visited.has(namespace)) return;

    // Cycle detection
    if (visiting.has(namespace)) {
      const cycleStart = path.indexOf(namespace);
      const cycle = [...path.slice(cycleStart), namespace].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${cycle}. ` +
          "Modules cannot have circular crossModuleDeps. " +
          "Break the cycle by removing one of the cross-module references.",
      );
    }

    visiting.add(namespace);
    path.push(namespace);

    // Visit dependencies first
    const mod = modulesMap[namespace];
    if (mod?.crossModuleDeps) {
      for (const depNamespace of Object.keys(mod.crossModuleDeps)) {
        if (namespaces.includes(depNamespace as keyof Modules & string)) {
          visit(depNamespace);
        }
      }
    }

    path.pop();
    visiting.delete(namespace);
    visited.add(namespace);
    result.push(namespace as keyof Modules & string);
  }

  for (const namespace of namespaces) {
    visit(namespace);
  }

  return result;
}

// ============================================================================
// Proxy Cache (Performance)
// ============================================================================

/**
 * WeakMap to cache module facts proxies. Keyed by the facts store object.
 * Inner map is keyed by namespace string.
 */
const moduleFactsProxyCache = new WeakMap<
  Record<string, unknown>,
  Map<string, Record<string, unknown>>
>();

/**
 * WeakMap to cache namespaced facts proxies.
 */
const namespacedFactsProxyCache = new WeakMap<
  Record<string, unknown>,
  Record<string, Record<string, unknown>>
>();

/**
 * WeakMap to cache namespaced derive proxies.
 */
const namespacedDeriveProxyCache = new WeakMap<
  Record<string, unknown>,
  Record<string, Record<string, unknown>>
>();

/**
 * WeakMap to cache module derive proxies.
 */
const moduleDeriveProxyCache = new WeakMap<
  Record<string, unknown>,
  Map<string, Record<string, unknown>>
>();

// ============================================================================
// createSystem
// ============================================================================

/**
 * Create a Directive system.
 *
 * Supports two modes:
 * - **Single module**: Use `module` prop for direct access without namespace
 * - **Multiple modules**: Use `modules` prop for namespaced access
 *
 * @remarks
 * The system is the top-level runtime object. It owns the reconciliation loop,
 * manages plugins, and exposes reactive accessors for facts, derivations, and events.
 * Call `system.start()` to begin the lifecycle (init → ready → running → settled).
 *
 * @param options - System configuration with either `module` (single) or `modules` (namespaced)
 * @returns A fully-typed {@link System} instance with reactive accessors
 *
 * @example Single module (direct access)
 * ```ts
 * const system = createSystem({ module: counterModule });
 * system.facts.count           // Direct access
 * system.events.increment()    // Direct events
 * ```
 *
 * @example Multiple modules (namespaced access)
 * ```ts
 * const system = createSystem({
 *   modules: { auth: authModule, data: dataModule },
 * });
 * system.facts.auth.token      // Namespaced access
 * system.events.auth.login()   // Namespaced events
 * ```
 *
 * @public
 */
export function createSystem<S extends ModuleSchema>(
  options: CreateSystemOptionsSingle<S>,
): SingleModuleSystem<S>;
export function createSystem<const Modules extends ModulesMap>(
  options: CreateSystemOptionsNamed<Modules>,
): NamespacedSystem<Modules>;
/** @internal Implementation overload — see public overloads above. */
export function createSystem<
  S extends ModuleSchema,
  Modules extends ModulesMap,
>(
  options: CreateSystemOptionsSingle<S> | CreateSystemOptionsNamed<Modules>,
): SingleModuleSystem<S> | NamespacedSystem<Modules> {
  // Single module mode (module prop)
  if ("module" in options) {
    if (!options.module) {
      throw new Error(
        "[Directive] createSystem requires a module. Got: " +
          typeof options.module,
      );
    }
    return createSingleModuleSystem(
      options as CreateSystemOptionsSingle<S>,
    ) as SingleModuleSystem<S>;
  }

  // Namespaced mode (modules prop)
  const namedOptions = options as CreateSystemOptionsNamed<Modules>;

  // Validate not an array
  if (Array.isArray(namedOptions.modules)) {
    throw new Error(
      "[Directive] createSystem expects modules as an object, not an array.\n\n" +
        "Instead of:\n" +
        "  createSystem({ modules: [authModule, dataModule] })\n\n" +
        "Use:\n" +
        "  createSystem({ modules: { auth: authModule, data: dataModule } })\n\n" +
        "Or for a single module:\n" +
        "  createSystem({ module: counterModule })",
    );
  }

  // Detect single ModuleDef accidentally passed to `modules:` instead of `module:`
  const mods = namedOptions.modules as Record<string, unknown>;
  if (mods && typeof mods === "object" && "id" in mods && "schema" in mods) {
    throw new Error(
      "[Directive] A single module was passed to `modules:`. " +
        "For a single module, use `module:` instead:\n\n" +
        "  createSystem({ module: myModule })\n\n" +
        "For multiple modules, wrap in an object:\n" +
        "  createSystem({ modules: { myName: myModule } })",
    );
  }

  return createNamespacedSystem(namedOptions) as NamespacedSystem<Modules>;
}

// ============================================================================
// Internal Implementation
// ============================================================================

function createNamespacedSystem<Modules extends ModulesMap>(
  options: CreateSystemOptionsNamed<Modules>,
): NamespacedSystem<Modules> {
  const modulesMap = options.modules;
  const moduleNamespaces = new Set(Object.keys(modulesMap));

  // Build snapshot module filter set (null = all modules snapshot)
  const historyConfig =
    typeof options.history === "object" ? options.history : null;
  const snapshotModulesSet = historyConfig?.snapshotModules
    ? new Set(historyConfig.snapshotModules)
    : null;

  // Validate tickMs if provided
  if (options.tickMs !== undefined && options.tickMs <= 0) {
    throw new Error("[Directive] tickMs must be a positive number");
  }

  // Dev-mode: Validate crossModuleDeps reference existing modules
  if (process.env.NODE_ENV !== "production") {
    for (const [namespace, mod] of Object.entries(modulesMap)) {
      if (mod.crossModuleDeps) {
        for (const depNamespace of Object.keys(mod.crossModuleDeps)) {
          if (depNamespace === namespace) {
            console.warn(
              `[Directive] Module "${namespace}" references itself in crossModuleDeps. ` +
                `Use "facts.self" to access own module's facts instead.`,
            );
          } else if (!moduleNamespaces.has(depNamespace)) {
            console.warn(
              `[Directive] Module "${namespace}" declares crossModuleDeps.${depNamespace}, ` +
                `but no module with namespace "${depNamespace}" exists in the system. ` +
                `Available modules: ${[...moduleNamespaces].join(", ")}`,
            );
          }
        }
      }
    }
  }

  // Dev-mode: Validate snapshotModules references existing modules
  if (process.env.NODE_ENV !== "production" && historyConfig?.snapshotModules) {
    for (const name of historyConfig.snapshotModules) {
      if (!moduleNamespaces.has(name)) {
        console.warn(
          `[Directive] history.snapshotModules entry "${name}" doesn't match any module. ` +
            `Available modules: ${[...moduleNamespaces].join(", ")}`,
        );
      }
    }
  }

  // Determine module initialization order
  let orderedNamespaces: Array<keyof Modules & string>;
  const initOrder = options.initOrder ?? "auto";

  if (Array.isArray(initOrder)) {
    // Explicit order provided - validate it includes all modules
    const explicitOrder = initOrder as Array<keyof Modules & string>;
    const missingModules = Object.keys(modulesMap).filter(
      (ns) => !explicitOrder.includes(ns as keyof Modules & string),
    );
    if (missingModules.length > 0) {
      throw new Error(
        `[Directive] initOrder is missing modules: ${missingModules.join(", ")}. ` +
          "All modules must be included in the explicit order.",
      );
    }
    orderedNamespaces = explicitOrder;
  } else if (initOrder === "declaration") {
    // Use object key order (current behavior)
    orderedNamespaces = Object.keys(modulesMap) as Array<
      keyof Modules & string
    >;
  } else {
    // "auto" - use topological sort based on crossModuleDeps
    orderedNamespaces = topologicalSort(modulesMap);
  }

  // Apply zero-config defaults if enabled
  let history = options.history;
  let trace = options.trace;
  let errorBoundary = options.errorBoundary;

  if (options.zeroConfig) {
    const isDev = process.env.NODE_ENV !== "production";

    history = history ?? isDev;

    errorBoundary = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...options.errorBoundary,
    };
  }

  // Validate module names and schema keys don't contain the separator
  for (const namespace of Object.keys(modulesMap)) {
    if (namespace.includes(SEPARATOR)) {
      throw new Error(
        `[Directive] Module name "${namespace}" contains the reserved separator "${SEPARATOR}". ` +
          `Module names cannot contain "${SEPARATOR}".`,
      );
    }
    const mod = modulesMap[namespace];
    if (mod) {
      for (const key of Object.keys(mod.schema.facts)) {
        if (key.includes(SEPARATOR)) {
          throw new Error(
            `[Directive] Schema key "${key}" in module "${namespace}" contains the reserved separator "${SEPARATOR}". ` +
              `Schema keys cannot contain "${SEPARATOR}".`,
          );
        }
      }
    }
  }

  // Transform modules to flat format with prefixed keys
  // auth.token → auth::token internally
  // Process in dependency order (determined above)
  const flatModules: Array<ModuleDef<ModuleSchema>> = [];

  for (const namespace of orderedNamespaces) {
    const mod = modulesMap[namespace];
    if (!mod) continue; // TypeScript guard - should never happen
    // Compute cross-module deps info once per module (used by derive, constraints, effects)
    const hasCrossModuleDeps =
      mod.crossModuleDeps && Object.keys(mod.crossModuleDeps).length > 0;
    const depNamespaces = hasCrossModuleDeps
      ? Object.keys(mod.crossModuleDeps!)
      : [];

    // Prefix all fact keys with namespace
    const prefixedFacts: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(mod.schema.facts)) {
      prefixedFacts[`${namespace}${SEPARATOR}${key}`] = value;
    }

    // Prefix all derivation keys with namespace
    const prefixedDerivations: Record<string, unknown> = {};
    if (mod.schema.derivations) {
      for (const [key, value] of Object.entries(mod.schema.derivations)) {
        prefixedDerivations[`${namespace}${SEPARATOR}${key}`] = value;
      }
    }

    // Prefix all event keys with namespace
    const prefixedEvents: Record<string, unknown> = {};
    if (mod.schema.events) {
      for (const [key, value] of Object.entries(mod.schema.events)) {
        prefixedEvents[`${namespace}${SEPARATOR}${key}`] = value;
      }
    }

    // Transform init to use prefixed keys
    // biome-ignore lint/suspicious/noExplicitAny: Facts proxy type coercion
    const prefixedInit = mod.init
      ? (facts: any) => {
          // Create a proxy that translates unprefixed keys to prefixed
          const moduleFactsProxy = createModuleFactsProxy(facts, namespace);
          // biome-ignore lint/suspicious/noExplicitAny: Module init type coercion
          (mod.init as any)(moduleFactsProxy);
        }
      : undefined;

    // Transform derive functions to use prefixed keys
    const prefixedDerive: Record<
      string,
      (facts: unknown, derive: unknown) => unknown
    > = {};
    if (mod.derive) {
      for (const [key, fn] of Object.entries(mod.derive)) {
        prefixedDerive[`${namespace}${SEPARATOR}${key}`] = (
          facts: unknown,
          derive: unknown,
        ) => {
          // Use cross-module proxy (facts.self + facts.{dep}) if crossModuleDeps is defined
          // Otherwise use flat access to own module only
          const factsProxy = hasCrossModuleDeps
            ? createCrossModuleFactsProxy(
                facts as Record<string, unknown>,
                namespace,
                depNamespaces,
              )
            : createModuleFactsProxy(
                facts as Record<string, unknown>,
                namespace,
              );
          // Derive proxy stays scoped to own module
          const deriveProxy = createModuleDeriveProxy(
            derive as Record<string, unknown>,
            namespace,
          );
          // biome-ignore lint/suspicious/noExplicitAny: Derive function type coercion
          return (fn as any)(factsProxy, deriveProxy);
        };
      }
    }

    // Transform event handlers to use prefixed keys
    const prefixedEventHandlers: Record<
      string,
      (facts: unknown, event: unknown) => void
    > = {};
    if (mod.events) {
      for (const [key, handler] of Object.entries(mod.events)) {
        prefixedEventHandlers[`${namespace}${SEPARATOR}${key}`] = (
          facts: unknown,
          event: unknown,
        ) => {
          const moduleFactsProxy = createModuleFactsProxy(
            facts as Record<string, unknown>,
            namespace,
          );
          // biome-ignore lint/suspicious/noExplicitAny: Event handler type coercion
          (handler as any)(moduleFactsProxy, event);
        };
      }
    }

    // Transform constraints to use namespaced facts proxy
    const prefixedConstraints: Record<string, unknown> = {};
    if (mod.constraints) {
      for (const [key, constraint] of Object.entries(mod.constraints)) {
        const constraintDef = constraint as {
          when: (facts: unknown) => boolean | Promise<boolean>;
          require: unknown | ((facts: unknown) => unknown);
          priority?: number;
          async?: boolean;
          timeout?: number;
          deps?: string[];
        };

        prefixedConstraints[`${namespace}${SEPARATOR}${key}`] = {
          ...constraintDef,
          // Transform deps to use prefixed keys
          deps: constraintDef.deps?.map(
            (dep) => `${namespace}${SEPARATOR}${dep}`,
          ),
          when: (facts: unknown) => {
            // Use cross-module proxy (facts.self + facts.{dep}) if crossModuleDeps is defined
            // Otherwise use module-scoped proxy for direct access (facts.key → namespace::key)
            const factsProxy = hasCrossModuleDeps
              ? createCrossModuleFactsProxy(
                  facts as Record<string, unknown>,
                  namespace,
                  depNamespaces,
                )
              : createModuleFactsProxy(
                  facts as Record<string, unknown>,
                  namespace,
                );
            return constraintDef.when(factsProxy);
          },
          require:
            typeof constraintDef.require === "function"
              ? (facts: unknown) => {
                  const factsProxy = hasCrossModuleDeps
                    ? createCrossModuleFactsProxy(
                        facts as Record<string, unknown>,
                        namespace,
                        depNamespaces,
                      )
                    : createModuleFactsProxy(
                        facts as Record<string, unknown>,
                        namespace,
                      );
                  return (constraintDef.require as (facts: unknown) => unknown)(
                    factsProxy,
                  );
                }
              : constraintDef.require,
        };
      }
    }

    // Transform resolvers to use namespaced facts proxy
    const prefixedResolvers: Record<string, unknown> = {};
    if (mod.resolvers) {
      for (const [key, resolver] of Object.entries(mod.resolvers)) {
        const resolverDef = resolver as {
          requirement: string;
          resolve: (
            req: unknown,
            ctx: { facts: unknown; signal: AbortSignal },
          ) => Promise<void>;
          key?: (req: unknown) => string;
          retry?: unknown;
          timeout?: number;
        };

        prefixedResolvers[`${namespace}${SEPARATOR}${key}`] = {
          ...resolverDef,
          resolve: async (
            req: unknown,
            ctx: { facts: unknown; signal: AbortSignal },
          ) => {
            const namespacedFacts = createNamespacedFactsProxy(
              ctx.facts as Record<string, unknown>,
              modulesMap,
              () => Object.keys(modulesMap),
            );
            await resolverDef.resolve(req, {
              facts: namespacedFacts[namespace],
              signal: ctx.signal,
            });
          },
        };
      }
    }

    // Transform effects to use namespaced facts proxy
    const prefixedEffects: Record<string, unknown> = {};
    if (mod.effects) {
      for (const [key, effect] of Object.entries(mod.effects)) {
        const effectDef = effect as {
          // biome-ignore lint/suspicious/noExplicitAny: Effect run function type
          run: (facts: any, prev: any) => void | Promise<void>;
          deps?: string[];
        };

        prefixedEffects[`${namespace}${SEPARATOR}${key}`] = {
          ...effectDef,
          // biome-ignore lint/suspicious/noExplicitAny: Effect run function wrapper
          run: (facts: any, prev: any) => {
            // Use cross-module proxy (facts.self + facts.{dep}) if crossModuleDeps is defined
            // Otherwise use module-scoped proxy for direct access (facts.key → namespace::key)
            const factsProxy = hasCrossModuleDeps
              ? createCrossModuleFactsProxy(
                  facts as Record<string, unknown>,
                  namespace,
                  depNamespaces,
                )
              : createModuleFactsProxy(
                  facts as Record<string, unknown>,
                  namespace,
                );
            const prevProxy = prev
              ? hasCrossModuleDeps
                ? createCrossModuleFactsProxy(
                    prev as Record<string, unknown>,
                    namespace,
                    depNamespaces,
                  )
                : createModuleFactsProxy(
                    prev as Record<string, unknown>,
                    namespace,
                  )
              : undefined;
            return effectDef.run(factsProxy, prevProxy);
          },
          // Transform deps to use prefixed keys
          deps: effectDef.deps?.map((dep) => `${namespace}${SEPARATOR}${dep}`),
        };
      }
    }

    flatModules.push({
      id: mod.id,
      schema: {
        facts: prefixedFacts,
        derivations: prefixedDerivations,
        events: prefixedEvents,
        requirements: mod.schema.requirements ?? {},
      },
      init: prefixedInit,
      derive: prefixedDerive,
      events: prefixedEventHandlers,
      effects: prefixedEffects,
      constraints: prefixedConstraints,
      resolvers: prefixedResolvers,
      hooks: mod.hooks,
      history: {
        snapshotEvents:
          snapshotModulesSet && !snapshotModulesSet.has(namespace)
            ? [] // Module excluded from snapshots
            : mod.history?.snapshotEvents?.map(
                (e: string) => `${namespace}${SEPARATOR}${e}`,
              ),
      },
      // biome-ignore lint/suspicious/noExplicitAny: Module transformation
    } as any);
  }

  // Dev-mode warning: tickMs set without tick event handler
  if (
    process.env.NODE_ENV !== "production" &&
    options.tickMs &&
    options.tickMs > 0
  ) {
    const hasTickHandler = flatModules.some(
      (m) =>
        m.events &&
        Object.keys(m.events).some((k) => k.endsWith(`${SEPARATOR}tick`)),
    );
    if (!hasTickHandler) {
      console.warn(
        `[Directive] tickMs is set to ${options.tickMs}ms but no module defines a "tick" event handler.`,
      );
    }
  }

  // Store for hydrated facts (set by hydrate(), applied during init)
  let hydratedFacts: Record<string, Record<string, unknown>> | null = null;

  // Engine reference (set after creation, used by applyNamespacedFacts)
  // biome-ignore lint/suspicious/noExplicitAny: Engine type
  let engine: any = null;

  /**
   * Apply namespaced facts to the engine's flat store.
   * Converts { auth: { token: "x" } } to { "auth::token": "x" }
   * Includes prototype pollution protection.
   */
  function applyNamespacedFacts(
    namespacedFacts: Record<string, Record<string, unknown>>,
  ): void {
    for (const [namespace, facts] of Object.entries(namespacedFacts)) {
      // Skip blocked property names
      if (BLOCKED_PROPS.has(namespace)) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[Directive] initialFacts/hydrate contains blocked namespace "${namespace}". Skipping.`,
          );
        }
        continue;
      }

      if (!moduleNamespaces.has(namespace)) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[Directive] initialFacts/hydrate contains unknown namespace "${namespace}". ` +
              `Available modules: ${[...moduleNamespaces].join(", ")}`,
          );
        }
        continue;
      }

      // Validate facts object for prototype pollution
      if (facts && typeof facts === "object" && !isPrototypeSafe(facts)) {
        throw new Error(
          `[Directive] initialFacts/hydrate for namespace "${namespace}" contains potentially ` +
            "dangerous keys (__proto__, constructor, or prototype). This may indicate a " +
            "prototype pollution attack.",
        );
      }

      for (const [key, value] of Object.entries(facts)) {
        // Skip blocked keys
        if (BLOCKED_PROPS.has(key)) continue;
        (engine.facts as Record<string, unknown>)[
          `${namespace}${SEPARATOR}${key}`
        ] = value;
      }
    }
  }

  // Create engine with flat modules
  engine = createEngine({
    // biome-ignore lint/suspicious/noExplicitAny: Module format conversion
    modules: flatModules.map((mod) => ({
      id: mod.id,
      schema: mod.schema.facts,
      requirements: mod.schema.requirements,
      init: mod.init,
      derive: mod.derive,
      events: mod.events,
      effects: mod.effects,
      constraints: mod.constraints,
      resolvers: mod.resolvers,
      hooks: mod.hooks,
      history: mod.history,
    })) as any,
    plugins: options.plugins,
    history,
    trace,
    errorBoundary,
    tickMs: options.tickMs,
    // Callback to apply initialFacts/hydrate during init phase (after module inits, before reconcile)
    onAfterModuleInit: () => {
      // Apply initialFacts first
      if (options.initialFacts) {
        applyNamespacedFacts(
          options.initialFacts as Record<string, Record<string, unknown>>,
        );
      }
      // Apply hydrated facts second (takes precedence)
      if (hydratedFacts) {
        applyNamespacedFacts(hydratedFacts);
        hydratedFacts = null;
      }
    },
  });

  // Build namespace → internal keys map (for subscribeModule / wildcard support)
  const namespaceKeysMap = new Map<string, string[]>();
  for (const namespace of Object.keys(modulesMap)) {
    const mod = modulesMap[namespace];
    if (!mod) continue;
    const keys: string[] = [];
    for (const key of Object.keys(mod.schema.facts)) {
      keys.push(`${namespace}${SEPARATOR}${key}`);
    }
    if (mod.schema.derivations) {
      for (const key of Object.keys(mod.schema.derivations)) {
        keys.push(`${namespace}${SEPARATOR}${key}`);
      }
    }
    namespaceKeysMap.set(namespace, keys);
  }

  // Cached module names array, shared by all namespaced proxies.
  // Set to null on registerModule to lazily recompute.
  const moduleNamesCache: { names: string[] | null } = { names: null };
  function getModuleNames(): string[] {
    if (moduleNamesCache.names === null) {
      moduleNamesCache.names = Object.keys(modulesMap);
    }
    return moduleNamesCache.names;
  }

  // Create namespaced proxies for external access
  const namespacedFactsProxy = createNamespacedFactsProxy(
    engine.facts as unknown as Record<string, unknown>,
    modulesMap,
    getModuleNames,
  );
  const namespacedDeriveProxy = createNamespacedDeriveProxy(
    engine.derive as unknown as Record<string, unknown>,
    modulesMap,
    getModuleNames,
  );
  const namespacedEventsProxy = createNamespacedEventsProxy(
    engine,
    modulesMap,
    getModuleNames,
  );

  // Build the namespaced system
  let tickInterval: ReturnType<typeof setInterval> | null = null;
  const tickMs = options.tickMs;

  const system: NamespacedSystem<Modules> = {
    _mode: "namespaced",
    facts: namespacedFactsProxy,
    history: engine.history,
    derive: namespacedDeriveProxy,
    events: namespacedEventsProxy,
    constraints: engine.constraints,
    effects: engine.effects,
    resolvers: engine.resolvers,

    get trace() {
      return engine.trace;
    },

    get isRunning() {
      return engine.isRunning;
    },

    get isSettled() {
      return engine.isSettled;
    },

    get isInitialized() {
      return engine.isInitialized;
    },

    get isReady() {
      return engine.isReady;
    },

    whenReady: engine.whenReady.bind(engine),

    async hydrate(
      loader: () =>
        | Promise<Record<string, Record<string, unknown>>>
        | Record<string, Record<string, unknown>>,
    ) {
      if (engine.isRunning) {
        throw new Error(
          "[Directive] hydrate() must be called before start(). " +
            "The system is already running.",
        );
      }

      const result = await loader();
      if (result && typeof result === "object") {
        hydratedFacts = result;
      }
    },

    initialize(): void {
      engine.initialize();
    },

    start(): void {
      // Engine.start() runs module inits, then applies initialFacts/hydrate via callback
      engine.start();

      if (tickMs && tickMs > 0) {
        // Find the first module with a tick event and dispatch to it
        const tickEventKey = Object.keys(flatModules[0]?.events ?? {}).find(
          (k) => k.endsWith(`${SEPARATOR}tick`),
        );
        if (tickEventKey) {
          tickInterval = setInterval(() => {
            engine.dispatch({ type: tickEventKey });
          }, tickMs);
        }
      }
    },

    stop(): void {
      if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
      engine.stop();
    },

    destroy(): void {
      this.stop();
      engine.destroy();
    },

    dispatch(event: { type: string; [key: string]: unknown }) {
      // Events are dispatched with namespace prefix
      // e.g., { type: "login", token: "abc" } from auth module
      // becomes { type: "auth::login", token: "abc" }
      // But we keep them simple - the event type should match the schema
      engine.dispatch(event);
    },

    batch: engine.batch.bind(engine),

    /**
     * Read a derivation value using namespaced syntax.
     * Accepts "namespace.key" format.
     *
     * @example
     * system.read("auth.status")  // → "authenticated"
     * system.read("data.count")   // → 5
     */
    read<T = unknown>(derivationId: string): T {
      return engine.read(toInternalKey(derivationId));
    },

    /**
     * Subscribe to derivation changes using namespaced syntax.
     * Accepts "namespace.key" format.
     * Supports wildcard "namespace.*" to subscribe to all keys in a module.
     *
     * @example
     * system.subscribe(["auth.status", "data.count"], () => {
     *   console.log("Auth or data changed");
     * });
     *
     * @example Wildcard
     * system.subscribe(["game.*", "chat.*"], () => render());
     */
    subscribe(ids: string[], listener: () => void): () => void {
      const internalIds: string[] = [];
      for (const id of ids) {
        if (id.endsWith(".*")) {
          const ns = id.slice(0, -2);
          const keys = namespaceKeysMap.get(ns);
          if (keys) {
            internalIds.push(...keys);
          } else if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[Directive] subscribe wildcard "${id}" — namespace "${ns}" not found.`,
            );
          }
        } else {
          internalIds.push(toInternalKey(id));
        }
      }
      return engine.subscribe(internalIds, listener);
    },

    /**
     * Subscribe to ALL fact and derivation changes in a module namespace.
     * Shorthand for subscribing to every key in a module.
     *
     * @example
     * const unsub = system.subscribeModule("game", () => render());
     */
    subscribeModule(namespace: string, listener: () => void): () => void {
      const keys = namespaceKeysMap.get(namespace);
      if (!keys || keys.length === 0) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[Directive] subscribeModule("${namespace}") — namespace not found. ` +
              `Available: ${[...namespaceKeysMap.keys()].join(", ")}`,
          );
        }
        return () => {};
      }
      return engine.subscribe(keys, listener);
    },

    /**
     * Watch a fact or derivation for changes using namespaced syntax.
     * The key is auto-detected -- works with both fact keys and derivation keys.
     * Accepts "namespace.key" format.
     *
     * @example
     * system.watch("auth.token", (newVal, oldVal) => { ... })   // fact
     * system.watch("auth.status", (newVal, oldVal) => { ... })  // derivation
     */
    watch<T = unknown>(
      id: string,
      callback: (newValue: T, previousValue: T | undefined) => void,
      options?: { equalityFn?: (a: T, b: T | undefined) => boolean },
    ): () => void {
      return engine.watch(toInternalKey(id), callback, options);
    },

    /**
     * Returns a promise that resolves when the predicate becomes true.
     * The predicate receives namespaced facts (e.g., facts.auth.token).
     */
    when(
      predicate: (facts: Record<string, unknown>) => boolean,
      options?: { timeout?: number },
    ): Promise<void> {
      // Wrap predicate to provide namespaced facts view
      return engine.when(
        () =>
          predicate(namespacedFactsProxy as unknown as Record<string, unknown>),
        options,
      );
    },

    onSettledChange: engine.onSettledChange.bind(engine),
    onHistoryChange: engine.onHistoryChange.bind(engine),
    inspect: engine.inspect.bind(engine),
    settle: engine.settle.bind(engine),
    explain: engine.explain.bind(engine),
    getSnapshot: engine.getSnapshot.bind(engine),
    restore: engine.restore.bind(engine),

    /**
     * Get a distributable snapshot with namespaced key translation.
     * Accepts "namespace.key" format in options (e.g., "auth.effectivePlan").
     * Returns data with namespaced keys (e.g., { auth: { effectivePlan: ... } }).
     */
    getDistributableSnapshot<T = Record<string, unknown>>(options?: {
      includeDerivations?: string[];
      excludeDerivations?: string[];
      includeFacts?: string[];
      ttlSeconds?: number;
      metadata?: Record<string, unknown>;
      includeVersion?: boolean;
    }): {
      data: T;
      createdAt: number;
      expiresAt?: number;
      version?: string;
      metadata?: Record<string, unknown>;
    } {
      // Translate namespaced keys to internal format
      const internalOptions = {
        ...options,
        includeDerivations: options?.includeDerivations?.map(toInternalKey),
        excludeDerivations: options?.excludeDerivations?.map(toInternalKey),
        includeFacts: options?.includeFacts?.map(toInternalKey),
      };

      const snapshot = engine.getDistributableSnapshot(internalOptions);

      // Transform data keys from internal format (auth::status) to namespaced format (auth: { status })
      const namespacedData: Record<string, Record<string, unknown>> = {};

      for (const [key, value] of Object.entries(
        snapshot.data as Record<string, unknown>,
      )) {
        // Find the namespace prefix (first separator)
        const sepIndex = key.indexOf(SEPARATOR);
        if (sepIndex > 0) {
          const namespace = key.slice(0, sepIndex);
          const localKey = key.slice(sepIndex + SEPARATOR.length);
          if (!namespacedData[namespace]) {
            namespacedData[namespace] = {};
          }
          namespacedData[namespace][localKey] = value;
        } else {
          // No namespace found, keep as-is
          if (!namespacedData._root) {
            namespacedData._root = {};
          }
          namespacedData._root[key] = value;
        }
      }

      return {
        ...snapshot,
        data: namespacedData as T,
      };
    },

    /**
     * Watch for changes to distributable snapshot derivations.
     * Accepts "namespace.key" format in options.
     * Callback receives data with namespaced keys.
     */
    watchDistributableSnapshot<T = Record<string, unknown>>(
      options: {
        includeDerivations?: string[];
        excludeDerivations?: string[];
        includeFacts?: string[];
        ttlSeconds?: number;
        metadata?: Record<string, unknown>;
        includeVersion?: boolean;
      },
      callback: (snapshot: {
        data: T;
        createdAt: number;
        expiresAt?: number;
        version?: string;
        metadata?: Record<string, unknown>;
      }) => void,
    ): () => void {
      // Translate namespaced keys to internal format
      const internalOptions = {
        ...options,
        includeDerivations: options?.includeDerivations?.map(toInternalKey),
        excludeDerivations: options?.excludeDerivations?.map(toInternalKey),
        includeFacts: options?.includeFacts?.map(toInternalKey),
      };

      return engine.watchDistributableSnapshot(
        internalOptions,
        (snapshot: {
          data: Record<string, unknown>;
          createdAt: number;
          expiresAt?: number;
          version?: string;
          metadata?: Record<string, unknown>;
        }) => {
          // Transform data keys from internal format to namespaced format
          const namespacedData: Record<string, Record<string, unknown>> = {};

          for (const [key, value] of Object.entries(snapshot.data)) {
            const sepIndex = key.indexOf(SEPARATOR);
            if (sepIndex > 0) {
              const namespace = key.slice(0, sepIndex);
              const localKey = key.slice(sepIndex + SEPARATOR.length);
              if (!namespacedData[namespace]) {
                namespacedData[namespace] = {};
              }
              namespacedData[namespace][localKey] = value;
            } else {
              if (!namespacedData._root) {
                namespacedData._root = {};
              }
              namespacedData._root[key] = value;
            }
          }

          callback({
            ...snapshot,
            data: namespacedData as T,
          });
        },
      );
    },
    registerModule(
      namespace: string,
      moduleDef: ModuleDef<ModuleSchema>,
    ): void {
      // Validate namespace
      if (moduleNamespaces.has(namespace)) {
        throw new Error(
          `[Directive] Module namespace "${namespace}" already exists. ` +
            "Cannot register a duplicate namespace.",
        );
      }
      if (namespace.includes(SEPARATOR)) {
        throw new Error(
          `[Directive] Module name "${namespace}" contains the reserved separator "${SEPARATOR}".`,
        );
      }
      if (BLOCKED_PROPS.has(namespace)) {
        throw new Error(
          `[Directive] Module name "${namespace}" is a blocked property.`,
        );
      }

      // Validate schema keys
      for (const key of Object.keys(moduleDef.schema.facts)) {
        if (key.includes(SEPARATOR)) {
          throw new Error(
            `[Directive] Schema key "${key}" in module "${namespace}" contains the reserved separator "${SEPARATOR}".`,
          );
        }
      }

      const mod = moduleDef;
      const hasCrossModuleDeps =
        mod.crossModuleDeps && Object.keys(mod.crossModuleDeps).length > 0;
      const depNamespaces = hasCrossModuleDeps
        ? Object.keys(mod.crossModuleDeps!)
        : [];

      // Build prefixed schema, derive, events, effects, constraints, resolvers
      // (same logic as initial createNamespacedSystem)
      const prefixedFacts: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(mod.schema.facts)) {
        prefixedFacts[`${namespace}${SEPARATOR}${key}`] = value;
      }

      const prefixedInit = mod.init
        ? // biome-ignore lint/suspicious/noExplicitAny: Module init type coercion
          (facts: any) => {
            const moduleFactsProxy = createModuleFactsProxy(facts, namespace);
            // biome-ignore lint/suspicious/noExplicitAny: Module init type coercion
            (mod.init as any)(moduleFactsProxy);
          }
        : undefined;

      const prefixedDerive: Record<
        string,
        (facts: unknown, derive: unknown) => unknown
      > = {};
      if (mod.derive) {
        for (const [key, fn] of Object.entries(mod.derive)) {
          prefixedDerive[`${namespace}${SEPARATOR}${key}`] = (
            facts: unknown,
            derive: unknown,
          ) => {
            const factsProxy = hasCrossModuleDeps
              ? createCrossModuleFactsProxy(
                  facts as Record<string, unknown>,
                  namespace,
                  depNamespaces,
                )
              : createModuleFactsProxy(
                  facts as Record<string, unknown>,
                  namespace,
                );
            const deriveProxy = createModuleDeriveProxy(
              derive as Record<string, unknown>,
              namespace,
            );
            // biome-ignore lint/suspicious/noExplicitAny: Derive function type coercion
            return (fn as any)(factsProxy, deriveProxy);
          };
        }
      }

      const prefixedEventHandlers: Record<
        string,
        (facts: unknown, event: unknown) => void
      > = {};
      if (mod.events) {
        for (const [key, handler] of Object.entries(mod.events)) {
          prefixedEventHandlers[`${namespace}${SEPARATOR}${key}`] = (
            facts: unknown,
            event: unknown,
          ) => {
            const moduleFactsProxy = createModuleFactsProxy(
              facts as Record<string, unknown>,
              namespace,
            );
            // biome-ignore lint/suspicious/noExplicitAny: Event handler type coercion
            (handler as any)(moduleFactsProxy, event);
          };
        }
      }

      const prefixedConstraints: Record<string, unknown> = {};
      if (mod.constraints) {
        for (const [key, constraint] of Object.entries(mod.constraints)) {
          const constraintDef = constraint as {
            when: (facts: unknown) => boolean | Promise<boolean>;
            require: unknown | ((facts: unknown) => unknown);
            priority?: number;
            async?: boolean;
            timeout?: number;
            deps?: string[];
          };
          prefixedConstraints[`${namespace}${SEPARATOR}${key}`] = {
            ...constraintDef,
            deps: constraintDef.deps?.map(
              (dep) => `${namespace}${SEPARATOR}${dep}`,
            ),
            when: (facts: unknown) => {
              const factsProxy = hasCrossModuleDeps
                ? createCrossModuleFactsProxy(
                    facts as Record<string, unknown>,
                    namespace,
                    depNamespaces,
                  )
                : createModuleFactsProxy(
                    facts as Record<string, unknown>,
                    namespace,
                  );
              return constraintDef.when(factsProxy);
            },
            require:
              typeof constraintDef.require === "function"
                ? (facts: unknown) => {
                    const factsProxy = hasCrossModuleDeps
                      ? createCrossModuleFactsProxy(
                          facts as Record<string, unknown>,
                          namespace,
                          depNamespaces,
                        )
                      : createModuleFactsProxy(
                          facts as Record<string, unknown>,
                          namespace,
                        );
                    return (
                      constraintDef.require as (facts: unknown) => unknown
                    )(factsProxy);
                  }
                : constraintDef.require,
          };
        }
      }

      const prefixedResolvers: Record<string, unknown> = {};
      if (mod.resolvers) {
        for (const [key, resolver] of Object.entries(mod.resolvers)) {
          const resolverDef = resolver as {
            requirement: string;
            resolve: (
              req: unknown,
              ctx: { facts: unknown; signal: AbortSignal },
            ) => Promise<void>;
            key?: (req: unknown) => string;
            retry?: unknown;
            timeout?: number;
          };
          prefixedResolvers[`${namespace}${SEPARATOR}${key}`] = {
            ...resolverDef,
            resolve: async (
              req: unknown,
              ctx: { facts: unknown; signal: AbortSignal },
            ) => {
              // Use live modulesMap reference (already mutated by registerModule before this runs)
              const namespacedFacts = createNamespacedFactsProxy(
                ctx.facts as Record<string, unknown>,
                modulesMap,
                getModuleNames,
              );
              await resolverDef.resolve(req, {
                facts: namespacedFacts[namespace],
                signal: ctx.signal,
              });
            },
          };
        }
      }

      const prefixedEffects: Record<string, unknown> = {};
      if (mod.effects) {
        for (const [key, effect] of Object.entries(mod.effects)) {
          const effectDef = effect as {
            // biome-ignore lint/suspicious/noExplicitAny: Effect run function type
            run: (facts: any, prev: any) => void | Promise<void>;
            deps?: string[];
          };
          prefixedEffects[`${namespace}${SEPARATOR}${key}`] = {
            ...effectDef,
            // biome-ignore lint/suspicious/noExplicitAny: Effect run function wrapper
            run: (facts: any, prev: any) => {
              const factsProxy = hasCrossModuleDeps
                ? createCrossModuleFactsProxy(
                    facts as Record<string, unknown>,
                    namespace,
                    depNamespaces,
                  )
                : createModuleFactsProxy(
                    facts as Record<string, unknown>,
                    namespace,
                  );
              const prevProxy = prev
                ? hasCrossModuleDeps
                  ? createCrossModuleFactsProxy(
                      prev as Record<string, unknown>,
                      namespace,
                      depNamespaces,
                    )
                  : createModuleFactsProxy(
                      prev as Record<string, unknown>,
                      namespace,
                    )
                : undefined;
              return effectDef.run(factsProxy, prevProxy);
            },
            deps: effectDef.deps?.map(
              (dep) => `${namespace}${SEPARATOR}${dep}`,
            ),
          };
        }
      }

      // Register namespace
      moduleNamespaces.add(namespace);
      (modulesMap as Record<string, ModuleDef<ModuleSchema>>)[namespace] = mod;
      // Invalidate cached module names so proxies see the new namespace
      moduleNamesCache.names = null;

      // Update namespace keys map
      const keys: string[] = [];
      for (const key of Object.keys(mod.schema.facts)) {
        keys.push(`${namespace}${SEPARATOR}${key}`);
      }
      if (mod.schema.derivations) {
        for (const key of Object.keys(mod.schema.derivations)) {
          keys.push(`${namespace}${SEPARATOR}${key}`);
        }
      }
      namespaceKeysMap.set(namespace, keys);

      // Delegate to engine's registerModule
      // biome-ignore lint/suspicious/noExplicitAny: Engine registerModule type
      (engine as any).registerModule({
        id: mod.id,
        schema: prefixedFacts,
        requirements: mod.schema.requirements ?? {},
        init: prefixedInit,
        derive:
          Object.keys(prefixedDerive).length > 0 ? prefixedDerive : undefined,
        events:
          Object.keys(prefixedEventHandlers).length > 0
            ? prefixedEventHandlers
            : undefined,
        effects:
          Object.keys(prefixedEffects).length > 0 ? prefixedEffects : undefined,
        constraints:
          Object.keys(prefixedConstraints).length > 0
            ? prefixedConstraints
            : undefined,
        resolvers:
          Object.keys(prefixedResolvers).length > 0
            ? prefixedResolvers
            : undefined,
        hooks: mod.hooks,
        history: {
          snapshotEvents:
            snapshotModulesSet && !snapshotModulesSet.has(namespace)
              ? [] // Module excluded from snapshots
              : mod.history?.snapshotEvents?.map(
                  (e: string) => `${namespace}${SEPARATOR}${e}`,
                ),
        },
      });
    },

    // biome-ignore lint/suspicious/noExplicitAny: Type narrowing for NamespacedSystem
  } as any;

  // Dev-mode warning if system.start() is never called
  if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
    setTimeout(() => {
      if (!system.isRunning && !system.isInitialized) {
        console.warn(
          "[Directive] System created but start() was never called. " +
            "Constraints, resolvers, and effects will not run until you call system.start().",
        );
      }
    }, 0);
  }

  return system;
}

// ============================================================================
// Key Conversion Helpers
// ============================================================================

/**
 * Convert a namespaced key (e.g., "auth.status") to internal prefixed format ("auth::status").
 * If the key is already in prefixed format, returns it unchanged.
 *
 * @example
 * toInternalKey("auth.status") // → "auth::status"
 * toInternalKey("auth::status") // → "auth::status" (unchanged)
 * toInternalKey("status")      // → "status" (unchanged)
 */
function toInternalKey(key: string): string {
  // If key contains a dot, convert to separator format
  if (key.includes(".")) {
    const [namespace, ...rest] = key.split(".");
    return `${namespace}${SEPARATOR}${rest.join(SEPARATOR)}`;
  }
  // Already in internal format or simple key
  return key;
}

// ============================================================================
// Proxy Helpers
// ============================================================================

/**
 * Create a proxy for a single module's facts (used in init, event handlers).
 * Translates unprefixed keys to prefixed: `token` → `auth::token`
 *
 * Proxies are cached per facts store and namespace for performance.
 */
function createModuleFactsProxy(
  facts: Record<string, unknown>,
  namespace: string,
): Record<string, unknown> {
  // Check cache first
  let namespaceCache = moduleFactsProxyCache.get(facts);
  if (namespaceCache) {
    const cached = namespaceCache.get(namespace);
    if (cached) {
      return cached;
    }
  } else {
    namespaceCache = new Map();
    moduleFactsProxyCache.set(facts, namespaceCache);
  }

  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return undefined;
      }
      if (BLOCKED_PROPS.has(prop)) {
        return undefined;
      }
      // Special properties pass through
      if (prop === "$store" || prop === "$snapshot") {
        return (facts as Record<string, unknown>)[prop];
      }
      return (facts as Record<string, unknown>)[
        `${namespace}${SEPARATOR}${prop}`
      ];
    },
    set(_, prop: string | symbol, value: unknown) {
      if (typeof prop === "symbol") {
        return false;
      }
      if (BLOCKED_PROPS.has(prop)) {
        return false;
      }
      (facts as Record<string, unknown>)[`${namespace}${SEPARATOR}${prop}`] =
        value;
      return true;
    },
    has(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return false;
      }
      if (BLOCKED_PROPS.has(prop)) {
        return false;
      }
      return `${namespace}${SEPARATOR}${prop}` in facts;
    },
    deleteProperty(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return false;
      }
      if (BLOCKED_PROPS.has(prop)) {
        return false;
      }
      delete (facts as Record<string, unknown>)[
        `${namespace}${SEPARATOR}${prop}`
      ];
      return true;
    },
    defineProperty() {
      return false;
    },
    getPrototypeOf() {
      return null;
    },
    setPrototypeOf() {
      return false;
    },
  });

  namespaceCache.set(namespace, proxy);
  return proxy;
}

/**
 * Create a nested proxy for namespaced facts access.
 * `facts.auth.token` → reads `auth::token` from flat store
 *
 * Uses Set for O(1) namespace lookups and caches the outer proxy.
 */
function createNamespacedFactsProxy(
  facts: Record<string, unknown>,
  modulesMap: ModulesMap,
  getModuleNames: () => string[],
): Record<string, Record<string, unknown>> {
  // Check cache first
  const cached = namespacedFactsProxyCache.get(facts);
  if (cached) {
    return cached;
  }

  const proxy = new Proxy({} as Record<string, Record<string, unknown>>, {
    get(_, namespace: string | symbol) {
      if (typeof namespace === "symbol") {
        return undefined;
      }
      if (BLOCKED_PROPS.has(namespace)) {
        return undefined;
      }
      if (!Object.hasOwn(modulesMap, namespace)) {
        return undefined;
      }

      // Return a cached proxy for this module's facts
      return createModuleFactsProxy(facts, namespace);
    },
    has(_, namespace: string | symbol) {
      if (typeof namespace === "symbol") {
        return false;
      }
      if (BLOCKED_PROPS.has(namespace)) {
        return false;
      }
      return Object.hasOwn(modulesMap, namespace);
    },
    ownKeys() {
      return getModuleNames();
    },
    getOwnPropertyDescriptor(_, namespace: string | symbol) {
      if (typeof namespace === "symbol") {
        return undefined;
      }
      if (Object.hasOwn(modulesMap, namespace)) {
        return { configurable: true, enumerable: true };
      }
      return undefined;
    },
    defineProperty() {
      return false;
    },
    getPrototypeOf() {
      return null;
    },
    setPrototypeOf() {
      return false;
    },
  });

  namespacedFactsProxyCache.set(facts, proxy);
  return proxy;
}

/**
 * WeakMap to cache cross-module facts proxies.
 * Keyed by facts store, then by "selfNamespace:depKeys" string.
 */
const crossModuleFactsProxyCache = new WeakMap<
  Record<string, unknown>,
  Map<string, Record<string, Record<string, unknown>>>
>();

/**
 * Create a proxy for cross-module facts access with "self" for own module.
 * `facts.self.users` → reads own module's facts
 * `facts.auth.token` → reads dependency module's facts
 *
 * Used when a module has crossModuleDeps defined.
 */
function createCrossModuleFactsProxy(
  facts: Record<string, unknown>,
  selfNamespace: string,
  depNamespaces: string[],
): Record<string, Record<string, unknown>> {
  // Create cache key using JSON.stringify for robustness with special characters
  const cacheKey = `${selfNamespace}:${JSON.stringify([...depNamespaces].sort())}`;

  // Check cache first
  let namespaceCache = crossModuleFactsProxyCache.get(facts);
  if (namespaceCache) {
    const cached = namespaceCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  } else {
    namespaceCache = new Map();
    crossModuleFactsProxyCache.set(facts, namespaceCache);
  }

  const depNamesSet = new Set(depNamespaces);
  const allKeys = ["self", ...depNamespaces];

  const proxy = new Proxy({} as Record<string, Record<string, unknown>>, {
    get(_, key: string | symbol) {
      if (typeof key === "symbol") {
        return undefined;
      }
      if (BLOCKED_PROPS.has(key)) {
        return undefined;
      }

      // "self" maps to own module's namespace
      if (key === "self") {
        return createModuleFactsProxy(facts, selfNamespace);
      }

      // Check if it's a declared dependency
      if (depNamesSet.has(key)) {
        return createModuleFactsProxy(facts, key);
      }

      // Dev-mode warning for undeclared cross-module access
      if (process.env.NODE_ENV !== "production" && typeof key === "string") {
        console.warn(
          `[Directive] Module "${selfNamespace}" accessed undeclared cross-module property "${key}". ` +
            `Add it to crossModuleDeps or use "facts.self.${key}" for own module facts.`,
        );
      }

      return undefined;
    },
    has(_, key: string | symbol) {
      if (typeof key === "symbol") {
        return false;
      }
      if (BLOCKED_PROPS.has(key)) {
        return false;
      }
      return key === "self" || depNamesSet.has(key);
    },
    ownKeys() {
      return allKeys;
    },
    getOwnPropertyDescriptor(_, key: string | symbol) {
      if (typeof key === "symbol") {
        return undefined;
      }
      if (key === "self" || depNamesSet.has(key)) {
        return { configurable: true, enumerable: true };
      }
      return undefined;
    },
    defineProperty() {
      return false;
    },
    getPrototypeOf() {
      return null;
    },
    setPrototypeOf() {
      return false;
    },
  });

  namespaceCache.set(cacheKey, proxy);
  return proxy;
}

/**
 * Create a proxy for a single module's derivations.
 * Translates unprefixed keys to prefixed: `status` → `auth::status`
 *
 * Proxies are cached per derive store and namespace for performance.
 */
function createModuleDeriveProxy(
  derive: Record<string, unknown>,
  namespace: string,
): Record<string, unknown> {
  // Check cache first
  let namespaceCache = moduleDeriveProxyCache.get(derive);
  if (namespaceCache) {
    const cached = namespaceCache.get(namespace);
    if (cached) {
      return cached;
    }
  } else {
    namespaceCache = new Map();
    moduleDeriveProxyCache.set(derive, namespaceCache);
  }

  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return undefined;
      }
      if (BLOCKED_PROPS.has(prop)) {
        return undefined;
      }
      return derive[`${namespace}${SEPARATOR}${prop}`];
    },
    has(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return false;
      }
      if (BLOCKED_PROPS.has(prop)) {
        return false;
      }
      return `${namespace}${SEPARATOR}${prop}` in derive;
    },
    set() {
      return false;
    },
    defineProperty() {
      return false;
    },
    getPrototypeOf() {
      return null;
    },
    setPrototypeOf() {
      return false;
    },
  });

  namespaceCache.set(namespace, proxy);
  return proxy;
}

/**
 * Create a nested proxy for namespaced derivations access.
 * `derive.auth.status` → reads `auth::status` from flat derive
 *
 * Uses Set for O(1) namespace lookups and caches the outer proxy.
 */
function createNamespacedDeriveProxy(
  derive: Record<string, unknown>,
  modulesMap: ModulesMap,
  getModuleNames: () => string[],
): Record<string, Record<string, unknown>> {
  // Check cache first
  const cached = namespacedDeriveProxyCache.get(derive);
  if (cached) {
    return cached;
  }

  const proxy = new Proxy({} as Record<string, Record<string, unknown>>, {
    get(_, namespace: string | symbol) {
      if (typeof namespace === "symbol") {
        return undefined;
      }
      if (BLOCKED_PROPS.has(namespace)) {
        return undefined;
      }
      if (!Object.hasOwn(modulesMap, namespace)) {
        return undefined;
      }

      // Return a cached proxy for this module's derivations
      return createModuleDeriveProxy(derive, namespace);
    },
    has(_, namespace: string | symbol) {
      if (typeof namespace === "symbol") {
        return false;
      }
      if (BLOCKED_PROPS.has(namespace)) {
        return false;
      }
      return Object.hasOwn(modulesMap, namespace);
    },
    ownKeys() {
      return getModuleNames();
    },
    getOwnPropertyDescriptor(_, namespace: string | symbol) {
      if (typeof namespace === "symbol") {
        return undefined;
      }
      if (Object.hasOwn(modulesMap, namespace)) {
        return { configurable: true, enumerable: true };
      }
      return undefined;
    },
    set() {
      return false;
    },
    defineProperty() {
      return false;
    },
    getPrototypeOf() {
      return null;
    },
    setPrototypeOf() {
      return false;
    },
  });

  namespacedDeriveProxyCache.set(derive, proxy);
  return proxy;
}

/**
 * WeakMap to cache module events proxies.
 */
const moduleEventsProxyCache = new WeakMap<
  // biome-ignore lint/suspicious/noExplicitAny: Engine type for cache key
  any,
  Map<string, Record<string, (payload?: Record<string, unknown>) => void>>
>();

/**
 * Create a nested proxy for namespaced events access.
 * `events.auth.login({ token })` → dispatches `{ type: "auth::login", token }`
 *
 * Uses Set for O(1) namespace lookups and caches proxies for performance.
 */
function createNamespacedEventsProxy(
  // biome-ignore lint/suspicious/noExplicitAny: Engine type
  engine: any,
  modulesMap: ModulesMap,
  getModuleNames: () => string[],
): Record<string, Record<string, (payload?: Record<string, unknown>) => void>> {
  // Get or create the namespace cache for this engine
  let namespaceCache = moduleEventsProxyCache.get(engine);
  if (!namespaceCache) {
    namespaceCache = new Map();
    moduleEventsProxyCache.set(engine, namespaceCache);
  }

  return new Proxy(
    {} as Record<
      string,
      Record<string, (payload?: Record<string, unknown>) => void>
    >,
    {
      get(_, namespace: string | symbol) {
        if (typeof namespace === "symbol") {
          return undefined;
        }
        if (BLOCKED_PROPS.has(namespace)) {
          return undefined;
        }
        if (!Object.hasOwn(modulesMap, namespace)) {
          return undefined;
        }

        // Check cache for this namespace's event proxy
        const cached = namespaceCache!.get(namespace);
        if (cached) {
          return cached;
        }

        // Create and cache the module events proxy
        const moduleEventsProxy = new Proxy(
          {} as Record<string, (payload?: Record<string, unknown>) => void>,
          {
            get(_, eventName: string | symbol) {
              if (typeof eventName === "symbol") {
                return undefined;
              }
              if (BLOCKED_PROPS.has(eventName)) {
                return undefined;
              }

              // Return a function that dispatches the prefixed event
              return (payload?: Record<string, unknown>) => {
                engine.dispatch({
                  type: `${namespace}${SEPARATOR}${eventName}`,
                  ...payload,
                });
              };
            },
            set() {
              return false;
            },
            defineProperty() {
              return false;
            },
            getPrototypeOf() {
              return null;
            },
            setPrototypeOf() {
              return false;
            },
          },
        );

        namespaceCache!.set(namespace, moduleEventsProxy);
        return moduleEventsProxy;
      },
      has(_, namespace: string | symbol) {
        if (typeof namespace === "symbol") {
          return false;
        }
        if (BLOCKED_PROPS.has(namespace)) {
          return false;
        }
        return Object.hasOwn(modulesMap, namespace);
      },
      ownKeys() {
        return getModuleNames();
      },
      getOwnPropertyDescriptor(_, namespace: string | symbol) {
        if (typeof namespace === "symbol") {
          return undefined;
        }
        if (Object.hasOwn(modulesMap, namespace)) {
          return { configurable: true, enumerable: true };
        }
        return undefined;
      },
      set() {
        return false;
      },
      defineProperty() {
        return false;
      },
      getPrototypeOf() {
        return null;
      },
      setPrototypeOf() {
        return false;
      },
    },
  );
}

// ============================================================================
// Single Module System
// ============================================================================

/**
 * Create a system with a single module (no namespacing).
 * Facts, derivations, and events are accessed directly.
 */
function createSingleModuleSystem<S extends ModuleSchema>(
  options: CreateSystemOptionsSingle<S>,
): SingleModuleSystem<S> {
  const mod = options.module;

  // Validate module is provided
  if (!mod) {
    throw new Error(
      "[Directive] createSystem requires a module. Got: " + typeof mod,
    );
  }

  // Validate tickMs if provided
  if (options.tickMs !== undefined && options.tickMs <= 0) {
    throw new Error("[Directive] tickMs must be a positive number");
  }

  // Validate initialFacts for prototype pollution
  if (options.initialFacts && !isPrototypeSafe(options.initialFacts)) {
    throw new Error(
      "[Directive] initialFacts contains potentially dangerous keys " +
        "(__proto__, constructor, or prototype). This may indicate a " +
        "prototype pollution attack.",
    );
  }

  // Dev-mode warnings
  if (process.env.NODE_ENV !== "production") {
    // Warn if crossModuleDeps is defined (ignored in single module mode)
    if (mod.crossModuleDeps && Object.keys(mod.crossModuleDeps).length > 0) {
      console.warn(
        "[Directive] Single module mode ignores crossModuleDeps. " +
          "Use multiple modules if cross-module access is needed: " +
          "createSystem({ modules: { ... } })",
      );
    }

    // Warn if tickMs set without tick event handler
    if (options.tickMs && options.tickMs > 0) {
      const hasTickHandler = mod.events && "tick" in mod.events;
      if (!hasTickHandler) {
        console.warn(
          `[Directive] tickMs is set to ${options.tickMs}ms but module has no "tick" event handler.`,
        );
      }
    }

    // Warn if snapshotModules is set (has no effect in single-module mode)
    const singleHistoryConfig =
      typeof options.history === "object" ? options.history : null;
    if (singleHistoryConfig?.snapshotModules) {
      console.warn(
        "[Directive] history.snapshotModules has no effect in single-module mode. " +
          "Use history.snapshotEvents on the module definition instead, or switch to " +
          "createSystem({ modules: { ... } }) for multi-module filtering.",
      );
    }
  }

  // Apply zero-config defaults if enabled
  let history = options.history;
  let trace = options.trace;
  let errorBoundary = options.errorBoundary;

  if (options.zeroConfig) {
    const isDev = process.env.NODE_ENV !== "production";

    history = history ?? isDev;

    errorBoundary = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...options.errorBoundary,
    };
  }

  // Store for hydrated facts
  let hydratedFacts: Record<string, unknown> | null = null;

  // Engine reference
  // biome-ignore lint/suspicious/noExplicitAny: Engine type
  let engine: any = null;

  // Create engine with the module directly (no prefixing needed)
  engine = createEngine({
    modules: [
      {
        id: mod.id,
        schema: mod.schema.facts,
        requirements: mod.schema.requirements,
        init: mod.init,
        derive: mod.derive,
        events: mod.events,
        effects: mod.effects,
        constraints: mod.constraints,
        resolvers: mod.resolvers,
        hooks: mod.hooks,
        history: mod.history,
      },
      // biome-ignore lint/suspicious/noExplicitAny: Module format
    ] as any,
    plugins: options.plugins,
    history,
    trace,
    errorBoundary,
    tickMs: options.tickMs,
    onAfterModuleInit: () => {
      // Apply initialFacts
      if (options.initialFacts) {
        for (const [key, value] of Object.entries(options.initialFacts)) {
          if (BLOCKED_PROPS.has(key)) continue;
          (engine.facts as Record<string, unknown>)[key] = value;
        }
      }
      // Apply hydrated facts (takes precedence)
      if (hydratedFacts) {
        for (const [key, value] of Object.entries(hydratedFacts)) {
          if (BLOCKED_PROPS.has(key)) continue;
          (engine.facts as Record<string, unknown>)[key] = value;
        }
        hydratedFacts = null;
      }
    },
  });

  // Create events proxy for direct access
  const eventsProxy = new Proxy(
    {} as Record<string, (payload?: Record<string, unknown>) => void>,
    {
      get(_, eventName: string | symbol) {
        if (typeof eventName === "symbol") {
          return undefined;
        }
        if (BLOCKED_PROPS.has(eventName)) {
          return undefined;
        }

        return (payload?: Record<string, unknown>) => {
          engine.dispatch({ type: eventName, ...payload });
        };
      },
      set() {
        return false;
      },
      defineProperty() {
        return false;
      },
      getPrototypeOf() {
        return null;
      },
      setPrototypeOf() {
        return false;
      },
    },
  );

  // Build the single module system
  let tickInterval: ReturnType<typeof setInterval> | null = null;
  const tickMs = options.tickMs;

  const system: SingleModuleSystem<S> = {
    _mode: "single",
    facts: engine.facts,
    history: engine.history,
    derive: engine.derive,
    events: eventsProxy as SingleModuleSystem<S>["events"],
    constraints: engine.constraints,
    effects: engine.effects,
    resolvers: engine.resolvers,

    get trace() {
      return engine.trace;
    },

    get isRunning() {
      return engine.isRunning;
    },

    get isSettled() {
      return engine.isSettled;
    },

    get isInitialized() {
      return engine.isInitialized;
    },

    get isReady() {
      return engine.isReady;
    },

    whenReady: engine.whenReady.bind(engine),

    async hydrate(
      loader: () => Promise<Record<string, unknown>> | Record<string, unknown>,
    ) {
      if (engine.isRunning) {
        throw new Error(
          "[Directive] hydrate() must be called before start(). " +
            "The system is already running.",
        );
      }

      const result = await loader();
      if (result && typeof result === "object") {
        hydratedFacts = result as Record<string, unknown>;
      }
    },

    initialize(): void {
      engine.initialize();
    },

    start(): void {
      engine.start();

      if (tickMs && tickMs > 0) {
        const hasTickHandler = mod.events && "tick" in mod.events;
        if (hasTickHandler) {
          tickInterval = setInterval(() => {
            engine.dispatch({ type: "tick" });
          }, tickMs);
        }
      }
    },

    stop(): void {
      if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
      engine.stop();
    },

    destroy(): void {
      this.stop();
      engine.destroy();
    },

    dispatch(event: { type: string; [key: string]: unknown }) {
      engine.dispatch(event);
    },

    batch: engine.batch.bind(engine),

    read<T = unknown>(derivationId: string): T {
      return engine.read(derivationId);
    },

    subscribe(ids: string[], listener: () => void): () => void {
      return engine.subscribe(ids, listener);
    },

    watch<T = unknown>(
      id: string,
      callback: (newValue: T, previousValue: T | undefined) => void,
      options?: { equalityFn?: (a: T, b: T | undefined) => boolean },
    ): () => void {
      return engine.watch(id, callback, options);
    },

    when(
      predicate: (facts: Record<string, unknown>) => boolean,
      options?: { timeout?: number },
    ): Promise<void> {
      return engine.when(predicate, options);
    },

    onSettledChange: engine.onSettledChange.bind(engine),
    onHistoryChange: engine.onHistoryChange.bind(engine),
    inspect: engine.inspect.bind(engine),
    settle: engine.settle.bind(engine),
    explain: engine.explain.bind(engine),
    getSnapshot: engine.getSnapshot.bind(engine),
    restore: engine.restore.bind(engine),
    getDistributableSnapshot: engine.getDistributableSnapshot.bind(engine),
    watchDistributableSnapshot: engine.watchDistributableSnapshot.bind(engine),

    registerModule(moduleDef: ModuleDef<ModuleSchema>): void {
      // biome-ignore lint/suspicious/noExplicitAny: Engine registerModule type
      (engine as any).registerModule({
        id: moduleDef.id,
        schema: moduleDef.schema.facts,
        requirements: moduleDef.schema.requirements,
        init: moduleDef.init,
        derive: moduleDef.derive,
        events: moduleDef.events,
        effects: moduleDef.effects,
        constraints: moduleDef.constraints,
        resolvers: moduleDef.resolvers,
        hooks: moduleDef.hooks,
        history: moduleDef.history,
      });
    },
    // biome-ignore lint/suspicious/noExplicitAny: Type narrowing
  } as any;

  // Dev-mode warning if system.start() is never called
  if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
    setTimeout(() => {
      if (!system.isRunning && !system.isInitialized) {
        console.warn(
          "[Directive] System created but start() was never called. " +
            "Constraints, resolvers, and effects will not run until you call system.start().",
        );
      }
    }, 0);
  }

  return system;
}
