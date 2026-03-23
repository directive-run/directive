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
import { prefixModuleDefinition } from "./system-module-transform.js";
import {
  SEPARATOR,
  createNamespacedDeriveProxy,
  createNamespacedEventsProxy,
  createNamespacedFactsProxy,
  denormalizeFlatKeys,
  toInternalKey,
} from "./system-proxies.js";
import { BLOCKED_PROPS } from "./tracking.js";
import type {
  CreateSystemOptionsNamed,
  CreateSystemOptionsSingle,
  ErrorBoundaryConfig,
  HistoryOption,
  ModuleDef,
  ModuleSchema,
  ModulesMap,
  NamespacedSystem,
  SingleModuleSystem,
  TraceOption,
} from "./types.js";

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
  const namespacesSet = new Set<string>(namespaces);
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
        if (namespacesSet.has(depNamespace)) {
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

/**
 * Build the list of internal prefixed keys (facts + derivations) for a module namespace.
 * Used by subscribe/subscribeModule to map namespaces to their engine keys.
 */
function collectNamespaceKeys(
  namespace: string,
  mod: ModuleDef<ModuleSchema>,
): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(mod.schema.facts)) {
    keys.push(`${namespace}${SEPARATOR}${key}`);
  }
  if (mod.schema.derivations) {
    for (const key of Object.keys(mod.schema.derivations)) {
      keys.push(`${namespace}${SEPARATOR}${key}`);
    }
  }

  return keys;
}

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
  const { history, trace, errorBoundary } = applyZeroConfigDefaults(options);

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

  // Cached module names array, shared by all namespaced proxies.
  // Set to null on registerModule to lazily recompute.
  const moduleNamesCache: { names: string[] | null } = { names: null };
  function getModuleNames(): string[] {
    if (moduleNamesCache.names === null) {
      moduleNamesCache.names = Object.keys(modulesMap);
    }

    return moduleNamesCache.names;
  }

  // Transform modules to flat format with prefixed keys
  // auth.token → auth::token internally
  // Process in dependency order (determined above)
  const flatModules = orderedNamespaces
    .map((namespace) => {
      const mod = modulesMap[namespace];
      if (!mod) return null; // TypeScript guard - should never happen

      return prefixModuleDefinition({
        mod,
        namespace,
        snapshotModulesSet,
      });
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

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
    modules: flatModules as any,
    plugins: options.plugins,
    history,
    trace,
    errorBoundary,
    tickMs: options.tickMs,
    pro: options.pro,
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
    namespaceKeysMap.set(namespace, collectNamespaceKeys(namespace, mod));
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
        let tickEventKey: string | undefined;
        for (const m of flatModules) {
          if (m?.events) {
            tickEventKey = Object.keys(m.events).find((k) =>
              k.endsWith(`${SEPARATOR}tick`),
            );
            if (tickEventKey) break;
          }
        }
        if (tickEventKey) {
          const key = tickEventKey;
          tickInterval = setInterval(() => {
            engine.dispatch({ type: key });
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
      return {
        ...snapshot,
        data: denormalizeFlatKeys(
          snapshot.data as Record<string, unknown>,
        ) as T,
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
          callback({
            ...snapshot,
            data: denormalizeFlatKeys(
              snapshot.data as Record<string, unknown>,
            ) as T,
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

      // Transform module definition with namespace prefixing
      const flat = prefixModuleDefinition({
        mod,
        namespace,
        snapshotModulesSet,
      });

      // Register namespace
      moduleNamespaces.add(namespace);
      (modulesMap as Record<string, ModuleDef<ModuleSchema>>)[namespace] = mod;
      // Invalidate cached module names so proxies see the new namespace
      moduleNamesCache.names = null;

      // Update namespace keys map
      namespaceKeysMap.set(namespace, collectNamespaceKeys(namespace, mod));

      // Delegate to engine's registerModule
      // biome-ignore lint/suspicious/noExplicitAny: Engine registerModule type
      (engine as any).registerModule(flat);
    },

    // biome-ignore lint/suspicious/noExplicitAny: Type narrowing for NamespacedSystem
  } as any;

  bindEnginePassthroughs(system, engine);
  warnIfNotStarted(system);

  return system;
}

// ============================================================================
// Shared Helpers (deduplication between single-module and namespaced systems)
// ============================================================================

/**
 * Apply zero-config defaults to system options (history, trace, errorBoundary).
 * Returns the resolved values; does not mutate the options object.
 */
function applyZeroConfigDefaults(options: {
  zeroConfig?: boolean;
  history?: HistoryOption;
  trace?: TraceOption;
  errorBoundary?: ErrorBoundaryConfig;
}): {
  history: HistoryOption | undefined;
  trace: TraceOption | undefined;
  errorBoundary: ErrorBoundaryConfig | undefined;
} {
  let history: HistoryOption | undefined = options.history;
  let trace: TraceOption | undefined = options.trace;
  let errorBoundary: ErrorBoundaryConfig | undefined = options.errorBoundary;

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

  return { history, trace, errorBoundary };
}

/**
 * Bind shared engine passthrough properties and methods onto a system object.
 * These are identical between single-module and namespaced systems.
 *
 * For methods that namespaced systems override (dispatch, read, subscribe,
 * watch, when, getDistributableSnapshot, watchDistributableSnapshot),
 * only binds them if not already defined on the system object.
 */
function bindEnginePassthroughs(
  // biome-ignore lint/suspicious/noExplicitAny: Engine type
  system: any,
  // biome-ignore lint/suspicious/noExplicitAny: Engine type
  engine: any,
): void {
  Object.defineProperties(system, {
    trace: {
      get() {
        return engine.trace;
      },
      enumerable: true,
      configurable: true,
    },
    isRunning: {
      get() {
        return engine.isRunning;
      },
      enumerable: true,
      configurable: true,
    },
    isSettled: {
      get() {
        return engine.isSettled;
      },
      enumerable: true,
      configurable: true,
    },
    isInitialized: {
      get() {
        return engine.isInitialized;
      },
      enumerable: true,
      configurable: true,
    },
    isReady: {
      get() {
        return engine.isReady;
      },
      enumerable: true,
      configurable: true,
    },
  });

  system.whenReady = engine.whenReady.bind(engine);
  system.batch = engine.batch.bind(engine);
  system.onSettledChange = engine.onSettledChange.bind(engine);
  system.onHistoryChange = engine.onHistoryChange.bind(engine);
  system.inspect = engine.inspect.bind(engine);
  system.settle = engine.settle.bind(engine);
  system.explain = engine.explain.bind(engine);
  system.getSnapshot = engine.getSnapshot.bind(engine);
  system.restore = engine.restore.bind(engine);

  // Direct engine passthroughs — only bind if not already defined
  // (namespaced systems override these with key-translating versions)
  const overridableMethods = [
    "dispatch",
    "read",
    "subscribe",
    "watch",
    "when",
    "getDistributableSnapshot",
    "watchDistributableSnapshot",
  ] as const;
  for (const method of overridableMethods) {
    if (!(method in system)) {
      system[method] = engine[method].bind(engine);
    }
  }
}

/**
 * Emit a dev-mode warning if system.start() is never called.
 */
function warnIfNotStarted(
  // biome-ignore lint/suspicious/noExplicitAny: System type
  system: any,
): void {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.NODE_ENV !== "test"
  ) {
    setTimeout(() => {
      if (!system.isRunning && !system.isInitialized) {
        console.warn(
          "[Directive] System created but start() was never called. " +
            "Constraints, resolvers, and effects will not run until you call system.start().",
        );
      }
    }, 0);
  }
}

// Proxy helpers and key conversion utilities are in system-proxies.ts

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
  const { history, trace, errorBoundary } = applyZeroConfigDefaults(options);

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
    pro: options.pro,
    onAfterModuleInit: () => {
      // Apply initialFacts (already validated for prototype safety above)
      if (options.initialFacts) {
        for (const [key, value] of Object.entries(options.initialFacts)) {
          if (BLOCKED_PROPS.has(key)) continue;
          (engine.facts as Record<string, unknown>)[key] = value;
        }
      }
      // Apply hydrated facts (takes precedence)
      if (hydratedFacts) {
        if (!isPrototypeSafe(hydratedFacts)) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              "[Directive] hydrate() data contains potentially dangerous keys. Skipping.",
            );
          }
        } else {
          for (const [key, value] of Object.entries(hydratedFacts)) {
            if (BLOCKED_PROPS.has(key)) continue;
            (engine.facts as Record<string, unknown>)[key] = value;
          }
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
      has(_, prop: string | symbol) {
        if (typeof prop === "symbol") {
          return false;
        }
        if (BLOCKED_PROPS.has(prop)) {
          return false;
        }

        return mod.events ? prop in mod.events : false;
      },
      ownKeys() {
        return mod.events ? Object.keys(mod.events) : [];
      },
      getOwnPropertyDescriptor(_, prop: string | symbol) {
        if (typeof prop === "symbol") {
          return undefined;
        }
        if (BLOCKED_PROPS.has(prop)) {
          return undefined;
        }
        if (mod.events && prop in mod.events) {
          return { configurable: true, enumerable: true };
        }

        return undefined;
      },
      set() {
        return false;
      },
      deleteProperty() {
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

  bindEnginePassthroughs(system, engine);
  warnIfNotStarted(system);

  return system;
}
