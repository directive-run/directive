/**
 * Proxy factory functions for system-level namespace translation.
 *
 * Extracted from system.ts to reduce file size. All functions are pure
 * proxy factories — they create proxies that translate between unprefixed
 * module keys and prefixed internal keys (e.g., `token` ↔ `auth::token`).
 *
 * @internal
 */

import isDevelopment from "#is-development";
import {
  BLOCKED_PROPS,
  detectNonJsonValueType,
  warnNonJsonFactAssignment,
} from "./tracking.js";
import type { ModulesMap } from "./types.js";

/**
 * Namespace separator for internal key prefixing (e.g., "auth::token").
 *
 * @internal
 */
export const SEPARATOR = "::";

// ============================================================================
// Hardened Proxy Factory
// ============================================================================

/**
 * Configuration for creating a hardened proxy with consistent security traps.
 *
 * @internal
 */
interface HardenedProxyConfig {
  /** Return the value for a string property access */
  get: (prop: string) => unknown;
  /** Handle property assignment. Omit for read-only proxies (returns false). */
  set?: (prop: string, value: unknown) => boolean;
  /** Check if a string property exists */
  has?: (prop: string) => boolean;
  /** Return all own keys for enumeration */
  ownKeys?: () => string[];
  /** Handle property deletion. Omit to reject deletions. */
  delete?: (prop: string) => boolean;
}

/**
 * Symbol used by Node.js's `util.inspect` (and vitest's pretty-format)
 * to ask an object for a custom inspection representation. Returning a
 * plain-object snapshot here avoids reflective walks on the proxy that
 * crash printers (e.g. `printComplexValue` reading `val.constructor.name`).
 *
 * @internal
 */
const NODE_INSPECT_CUSTOM = Symbol.for("nodejs.util.inspect.custom");

/**
 * Build a plain-object snapshot from a hardened proxy config. Used as the
 * inspection hook so that printers see real keys/values instead of trapping
 * on the proxy.
 *
 * @internal
 */
function buildHardenedSnapshot(config: HardenedProxyConfig): unknown {
  if (!config.ownKeys) {
    return {};
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of config.ownKeys()) {
    snapshot[key] = config.get(key);
  }

  return snapshot;
}

/**
 * Create a proxy with consistent security hardening.
 *
 * Every proxy created by this factory includes:
 * - Symbol access returns `undefined` (except the inspection hook below)
 * - `Symbol.for('nodejs.util.inspect.custom')` returns a function that
 *   produces a plain-object snapshot, so vitest pretty-format / Node's
 *   `util.inspect` / `console.log` render the proxy correctly without
 *   tripping on reflective walks (e.g. `printComplexValue` reading
 *   `val.constructor.name`).
 * - `Symbol.toPrimitive` is intentionally NOT set: the get trap returns
 *   `undefined` for it so JS falls back to default `toString`/`valueOf`
 *   coercion. Returning a snapshot object here would `TypeError` because
 *   the protocol requires a primitive return.
 * - BLOCKED_PROPS (`__proto__`, `constructor`, `prototype`) rejected
 * - `defineProperty` returns `false`
 * - `getPrototypeOf` returns `null`
 * - `setPrototypeOf` returns `false`
 *
 * Note: per the Risk reviewer we deliberately do NOT add a `toJSON` shim —
 * that would change `JSON.stringify(proxy)` semantics for users who already
 * rely on the existing shape.
 *
 * @internal
 */
function createHardenedProxy<T extends object>(config: HardenedProxyConfig): T {
  return new Proxy({} as T, {
    get(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
        // Inspection hook: return a snapshot function so printers
        // don't walk the proxy reflectively (which crashes pretty-format).
        if (prop === NODE_INSPECT_CUSTOM) {
          return () => buildHardenedSnapshot(config);
        }
        return undefined;
      }
      if (BLOCKED_PROPS.has(prop)) {
        return undefined;
      }

      return config.get(prop);
    },
    set(_, prop: string | symbol, value: unknown) {
      if (typeof prop === "symbol") {
        return false;
      }
      if (BLOCKED_PROPS.has(prop)) {
        return false;
      }

      return config.set ? config.set(prop, value) : false;
    },
    has(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return false;
      }
      if (BLOCKED_PROPS.has(prop)) {
        return false;
      }

      return config.has ? config.has(prop) : false;
    },
    deleteProperty(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return false;
      }
      if (BLOCKED_PROPS.has(prop)) {
        return false;
      }

      return config.delete ? config.delete(prop) : false;
    },
    ownKeys() {
      return config.ownKeys ? config.ownKeys() : [];
    },
    getOwnPropertyDescriptor(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return undefined;
      }
      if (config.has && typeof prop === "string" && config.has(prop)) {
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

/**
 * WeakMap to cache cross-module facts proxies.
 * Keyed by facts store, then by "selfNamespace|depKeys" string.
 */
const crossModuleFactsProxyCache = new WeakMap<
  Record<string, unknown>,
  Map<string, Record<string, Record<string, unknown>>>
>();

/**
 * WeakMap to cache module events proxies.
 */
const moduleEventsProxyCache = new WeakMap<
  any,
  Map<string, Record<string, (payload?: Record<string, unknown>) => void>>
>();

// ============================================================================
// Module Facts Proxy
// ============================================================================

/**
 * Create a proxy for a single module's facts (used in init, event handlers).
 * Translates unprefixed keys to prefixed: `token` → `auth::token`
 *
 * Proxies are cached per facts store and namespace for performance.
 *
 * @param facts - The flat facts store
 * @param namespace - The module namespace for key prefixing
 * @returns A proxy that translates property access to prefixed keys
 *
 * @internal
 */
export function createModuleFactsProxy(
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

  const proxy = createHardenedProxy<Record<string, unknown>>({
    get: (prop) => {
      // Reserved properties bypass namespace prefixing (used by engine internals)
      if (prop === "$store" || prop === "$snapshot") {
        return facts[prop];
      }

      return facts[`${namespace}${SEPARATOR}${prop}`];
    },
    set: (prop, value) => {
      // Dev-mode: warn (once per path/type) when assigning non-JSON values
      // that break reactivity. See `warnNonJsonFactAssignment` in tracking.ts.
      if (isDevelopment) {
        const nonJsonType = detectNonJsonValueType(value);
        if (nonJsonType) {
          warnNonJsonFactAssignment(`${namespace}.${prop}`, nonJsonType);
        }
      }

      facts[`${namespace}${SEPARATOR}${prop}`] = value;

      return true;
    },
    has: (prop) => `${namespace}${SEPARATOR}${prop}` in facts,
    delete: (prop) => {
      delete facts[`${namespace}${SEPARATOR}${prop}`];

      return true;
    },
    // Without this the proxy enumerates as empty while every read still
    // works, so `{ ...facts }`, `Object.keys(facts)` and `JSON.stringify(facts)`
    // quietly produce `{}` for a namespaced module. Spread is how a snapshot is
    // usually taken, which makes the empty result look like an empty module.
    ownKeys: () => {
      const prefix = `${namespace}${SEPARATOR}`;
      const keys: string[] = [];
      for (const key of Object.keys(facts)) {
        if (key.startsWith(prefix)) {
          keys.push(key.slice(prefix.length));
        }
      }

      return keys;
    },
  });

  namespaceCache.set(namespace, proxy);

  return proxy;
}

// ============================================================================
// Namespaced Facts Proxy
// ============================================================================

/**
 * Create a nested proxy for namespaced facts access.
 * `facts.auth.token` → reads `auth::token` from flat store
 *
 * Uses Set for O(1) namespace lookups and caches the outer proxy.
 *
 * @param facts - The flat facts store
 * @param modulesMap - Map of module namespaces to module definitions
 * @param getModuleNames - Function returning current module names (supports dynamic registration)
 * @returns A proxy that delegates to per-module facts proxies
 *
 * @internal
 */
export function createNamespacedFactsProxy(
  facts: Record<string, unknown>,
  modulesMap: ModulesMap,
  getModuleNames: () => string[],
): Record<string, Record<string, unknown>> {
  // Check cache first
  const cached = namespacedFactsProxyCache.get(facts);
  if (cached) {
    return cached;
  }

  const proxy = createHardenedProxy<Record<string, Record<string, unknown>>>({
    get: (namespace) => {
      if (!Object.hasOwn(modulesMap, namespace)) {
        return undefined;
      }

      return createModuleFactsProxy(facts, namespace);
    },
    has: (namespace) => Object.hasOwn(modulesMap, namespace),
    ownKeys: () => getModuleNames(),
  });

  namespacedFactsProxyCache.set(facts, proxy);

  return proxy;
}

// ============================================================================
// Cross-Module Facts Proxy
// ============================================================================

/**
 * The role a cross-module facts proxy is serving. Only changes the advice a
 * rejected write prints – every role reads the same way.
 *
 * @internal
 */
export type CrossModuleProxyRole = "derive" | "constraint" | "effect";

const ROLE_NOUN: Record<CrossModuleProxyRole, [string, string]> = {
  derive: ["a derivation", "Derivations"],
  constraint: ["a constraint", "Constraints"],
  effect: ["an effect", "Effects"],
};

/**
 * Create a proxy for cross-module facts access with "self" for own module.
 * `facts.self.users` → reads own module's facts
 * `facts.auth.token` → reads dependency module's facts
 *
 * Used when a module has crossModuleDeps defined.
 *
 * @param facts - The flat facts store
 * @param selfNamespace - The namespace of the module that owns this proxy
 * @param depNamespaces - Array of declared dependency namespaces
 * @returns A proxy that provides `self` and declared dependency access
 *
 * @internal
 */
export function createCrossModuleFactsProxy(
  facts: Record<string, unknown>,
  selfNamespace: string,
  depNamespaces: string[],
  role: CrossModuleProxyRole = "constraint",
): Record<string, Record<string, unknown>> {
  // depNamespaces comes from Object.keys() which has stable order per module,
  // so join is sufficient (no need to sort)
  const cacheKey = `${selfNamespace}|${depNamespaces.join(",")}|${role}`;

  // Check cache first
  let namespaceCache = crossModuleFactsProxyCache.get(facts);
  if (namespaceCache) {
    const cachedProxy = namespaceCache.get(cacheKey);
    if (cachedProxy) {
      return cachedProxy;
    }
  } else {
    namespaceCache = new Map();
    crossModuleFactsProxyCache.set(facts, namespaceCache);
  }

  const depNamesSet = new Set(depNamespaces);
  const allKeys = ["self", ...depNamespaces];
  const [roleSingular, rolePlural] = ROLE_NOUN[role];

  const proxy = createHardenedProxy<Record<string, Record<string, unknown>>>({
    get: (key) => {
      // "self" maps to own module's namespace
      if (key === "self") {
        return createModuleFactsProxy(facts, selfNamespace);
      }

      // Check if it's a declared dependency
      if (depNamesSet.has(key)) {
        return createModuleFactsProxy(facts, key);
      }

      // Dev-mode warning for undeclared cross-module access
      if (isDevelopment) {
        console.warn(
          `[Directive] Module "${selfNamespace}" accessed undeclared cross-module property "${key}". ` +
            `Add it to crossModuleDeps or use "facts.self.${key}" for own module facts.`,
        );
      }

      return undefined;
    },
    // The top level only maps namespaces, so a write here always fails. Say
    // why, once per system, instead of leaving a bare TypeError.
    set: (key) => {
      warnOncePerSystem(
        facts,
        `cross-module-set|${selfNamespace}|${role}|${key}`,
        () =>
          `[Directive] Module "${selfNamespace}": ${roleSingular} tried to write "${key}". ${rolePlural} read facts and never write them – change "${key}" from an event handler or a resolver.`,
      );

      return false;
    },
    has: (key) => key === "self" || depNamesSet.has(key),
    ownKeys: () => allKeys,
  });

  namespaceCache.set(cacheKey, proxy);

  return proxy;
}

// ============================================================================
// Per-system dev warnings
// ============================================================================

/**
 * Warning keys already printed, per system. Keyed weakly by the system's
 * fact store so a second system in the same process hears about the same
 * mistake, and the record dies with the system it describes.
 */
const warnedOnceBySystem = new WeakMap<object, Set<string>>();

/** Cap per system so a stream of distinct keys can't grow the set forever. */
const MAX_WARNED_KEYS_PER_SYSTEM = 1000;

/**
 * The object that identifies a system from any facts view handed to a
 * callback. Resolvers can receive a per-call bound view, so the view itself
 * is not stable – the store behind it is.
 */
function systemKeyOf(facts: Record<string, unknown>): object {
  try {
    const store = facts.$store;
    if (store && typeof store === "object") {
      return store;
    }
  } catch {
    // Fall back to the view itself.
  }

  return facts;
}

/**
 * Print a development warning once per system for a given key.
 *
 * @internal
 */
export function warnOncePerSystem(
  facts: Record<string, unknown>,
  key: string,
  message: () => string,
): void {
  if (!isDevelopment) {
    return;
  }
  const systemKey = systemKeyOf(facts);
  let warned = warnedOnceBySystem.get(systemKey);
  if (warned === undefined) {
    warned = new Set<string>();
    warnedOnceBySystem.set(systemKey, warned);
  }
  if (warned.has(key)) {
    return;
  }
  warned.add(key);
  if (warned.size > MAX_WARNED_KEYS_PER_SYSTEM) {
    const oldest = warned.values().next().value;
    if (oldest !== undefined) {
      warned.delete(oldest);
    }
  }
  console.warn(message());
}

// ============================================================================
// Read-only module views (resolver deps, source gates)
// ============================================================================

type ProxyCache = WeakMap<
  Record<string, unknown>,
  Map<string, Record<string, unknown>>
>;

/** Cache of read-only module views, per facts store then `kind|owner|ns`. */
const readonlyViewCache: ProxyCache = new WeakMap();

/** Look up or build a cached proxy in a per-facts-store map. */
function cachedProxy(
  cache: ProxyCache,
  facts: Record<string, unknown>,
  key: string,
  build: () => Record<string, unknown>,
): Record<string, unknown> {
  let byKey = cache.get(facts);
  if (byKey === undefined) {
    byKey = new Map();
    cache.set(facts, byKey);
  }
  let proxy = byKey.get(key);
  if (proxy === undefined) {
    proxy = build();
    byKey.set(key, proxy);
  }

  return proxy;
}

/**
 * A read-only view of one module's facts with bare keys. `onWrite` decides
 * what a write does – it returns the trap result, or throws.
 */
function createReadonlyModuleFactsView(
  facts: Record<string, unknown>,
  namespace: string,
  cacheKey: string,
  onWrite: (key: string) => boolean,
): Record<string, unknown> {
  return cachedProxy(readonlyViewCache, facts, cacheKey, () => {
    const prefix = `${namespace}${SEPARATOR}`;

    return createHardenedProxy<Record<string, unknown>>({
      get: (prop) => facts[`${prefix}${prop}`],
      set: (prop) => onWrite(prop),
      delete: (prop) => onWrite(prop),
      has: (prop) => `${prefix}${prop}` in facts,
      ownKeys: () => {
        const keys: string[] = [];
        for (const key of Object.keys(facts)) {
          if (key.startsWith(prefix)) {
            keys.push(key.slice(prefix.length));
          }
        }

        return keys;
      },
    });
  });
}

// ============================================================================
// Resolver Facts Proxy
// ============================================================================

/** Cache of resolver facts / deps proxies, per facts store then `kind|self|deps`. */
const resolverProxyCache: ProxyCache = new WeakMap();

/**
 * A resolver's read-only view of a dependency module. Another module's facts
 * belong to that module: a write throws in development and is ignored in
 * production, so a resolver can never change state it doesn't own.
 */
function resolverDepView(
  facts: Record<string, unknown>,
  selfNamespace: string,
  depNamespace: string,
): Record<string, unknown> {
  return createReadonlyModuleFactsView(
    facts,
    depNamespace,
    `resolver|${selfNamespace}|${depNamespace}`,
    (key) => {
      if (isDevelopment) {
        throw new Error(
          `[Directive] Module "${selfNamespace}": a resolver wrote "${depNamespace}.${key}". Another module's facts are read-only from a resolver – emit a requirement or dispatch an event that module "${depNamespace}" owns instead.`,
        );
      }

      return true;
    },
  );
}

/**
 * Create the `ctx.deps` a resolver receives in a module with
 * `crossModuleDeps`: one read-only view per declared dependency
 * (`ctx.deps.auth.token`).
 *
 * @internal
 */
export function createResolverDepsProxy(
  facts: Record<string, unknown>,
  selfNamespace: string,
  depNamespaces: string[],
): Record<string, unknown> {
  return cachedProxy(
    resolverProxyCache,
    facts,
    `deps|${selfNamespace}|${depNamespaces.join(",")}`,
    () => {
      const depNamesSet = new Set(depNamespaces);

      return createHardenedProxy<Record<string, unknown>>({
        get: (prop) => {
          if (depNamesSet.has(prop)) {
            return resolverDepView(facts, selfNamespace, prop);
          }
          if (!RUNTIME_PROBE_PROPS.has(prop)) {
            warnOncePerSystem(
              facts,
              `resolver-deps|${selfNamespace}|${prop}`,
              () =>
                `[Directive] Module "${selfNamespace}": a resolver read ctx.deps.${prop}, but "${prop}" is not in crossModuleDeps. Declared: ${depNamespaces.join(", ")}.`,
            );
          }

          return undefined;
        },
        set: (prop) => {
          if (isDevelopment) {
            throw new Error(
              `[Directive] Module "${selfNamespace}": ctx.deps is read-only (tried to set "${prop}").`,
            );
          }

          return true;
        },
        has: (prop) => depNamesSet.has(prop),
        ownKeys: () => [...depNamespaces],
      });
    },
  );
}

/**
 * The `$store` a namespaced resolver sees: the system's store, scoped to the
 * module's own facts. Keys are the module's bare fact names (`"draft"`); the
 * module's own prefixed form (`"notes::draft"`) is accepted too. A write to
 * any other module's key throws in development and is ignored in
 * production, the same rule as `ctx.deps`. Reads of another module's key
 * return `undefined` – read dependencies through `ctx.deps`.
 */
function createScopedResolverStore(
  facts: Record<string, unknown>,
  selfNamespace: string,
): Record<string, unknown> {
  return cachedProxy(
    resolverProxyCache,
    facts,
    `store|${selfNamespace}`,
    () => {
      const prefix = `${selfNamespace}${SEPARATOR}`;
      const store = facts.$store as {
        get(key: string): unknown;
        has(key: string): boolean;
        set(key: string, value: unknown): void;
        delete(key: string): void;
        batch(fn: () => void): void;
        subscribe(keys: string[], listener: () => void): () => void;
        subscribeAll(listener: () => void): () => void;
        toObject(): Record<string, unknown>;
      };

      /** Full key for an own fact, or null when the key names another module. */
      function ownKey(key: unknown): string | null {
        if (typeof key !== "string") {
          return null;
        }
        if (key.startsWith(prefix)) {
          return key;
        }
        if (key.includes(SEPARATOR)) {
          return null;
        }

        return `${prefix}${key}`;
      }

      function rejectWrite(key: unknown): void {
        if (isDevelopment) {
          const target = String(key);
          const owner = target.includes(SEPARATOR)
            ? target.slice(0, target.indexOf(SEPARATOR))
            : "another module";
          throw new Error(
            `[Directive] Module "${selfNamespace}": a resolver wrote "${target}" through ctx.facts.$store. Another module's facts are read-only from a resolver – emit a requirement or dispatch an event that module "${owner}" owns instead.`,
          );
        }
      }

      const scoped = {
        get: (key: string) => {
          const full = ownKey(key);

          return full === null ? undefined : store.get(full);
        },
        has: (key: string) => {
          const full = ownKey(key);

          return full === null ? false : store.has(full);
        },
        set: (key: string, value: unknown) => {
          const full = ownKey(key);
          if (full === null) {
            rejectWrite(key);

            return;
          }
          store.set(full, value);
        },
        delete: (key: string) => {
          const full = ownKey(key);
          if (full === null) {
            rejectWrite(key);

            return;
          }
          store.delete(full);
        },
        // Writes inside the batch go through this scoped store or the scoped
        // facts proxy, so they are checked one by one.
        batch: (fn: () => void) => store.batch(fn),
        subscribe: (keys: string[], listener: () => void) =>
          store.subscribe(
            keys
              .map((key) => ownKey(key))
              .filter((k): k is string => k !== null),
            listener,
          ),
        subscribeAll: (listener: () => void) => store.subscribeAll(listener),
        toObject: () => {
          const out: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(store.toObject())) {
            if (key.startsWith(prefix)) {
              out[key.slice(prefix.length)] = value;
            }
          }

          return out;
        },
      };

      return Object.freeze(scoped) as unknown as Record<string, unknown>;
    },
  );
}

/**
 * Create the facts proxy a resolver receives in a module with
 * `crossModuleDeps`.
 *
 * Resolvers use flat, own-module access (`ctx.facts.draft`) – what their
 * types declare, and what event handlers get – and read dependencies through
 * `ctx.deps.<ns>`. Before 1.35 the runtime handed resolvers the cross-module
 * proxy instead, so a typed write threw and the error was swallowed. Code
 * written against that runtime spelled it `ctx.facts.self.draft` /
 * `ctx.facts.auth.token`; both keep working here and warn once per system in
 * development. The dependency pivot is read-only, like `ctx.deps`.
 *
 * `self` and dep namespace names are reserved fact keys (createModule
 * rejects them), so the pivots can never shadow a real fact. They answer
 * `in` but are not enumerated: `Object.keys(ctx.facts)` lists own facts.
 *
 * @internal
 */
export function createResolverFactsProxy(
  facts: Record<string, unknown>,
  selfNamespace: string,
  depNamespaces: string[],
  pivots = true,
): Record<string, unknown> {
  return cachedProxy(
    resolverProxyCache,
    facts,
    `facts|${selfNamespace}|${depNamespaces.join(",")}|${pivots}`,
    () => {
      const moduleFacts = createModuleFactsProxy(facts, selfNamespace);
      const depNamesSet = new Set(pivots ? depNamespaces : []);
      const scopedStore = createScopedResolverStore(facts, selfNamespace);
      const scopedSnapshot = () => scopedStore;

      // The module's own facts, with `$store` / `$snapshot` scoped to them.
      // The module facts proxy passes those two straight through to the
      // system-wide store, which let `ctx.facts.$store.set("auth::token")`
      // write a module the resolver doesn't own.
      const own = createHardenedProxy<Record<string, unknown>>({
        get: (prop) => {
          if (prop === "$store") {
            return scopedStore;
          }
          if (prop === "$snapshot") {
            return scopedSnapshot;
          }

          return moduleFacts[prop];
        },
        set: (prop, value) => {
          moduleFacts[prop] = value;

          return true;
        },
        has: (prop) => prop in moduleFacts,
        delete: (prop) => Reflect.deleteProperty(moduleFacts, prop),
        ownKeys: () => Object.keys(moduleFacts),
      });

      function warnLegacy(pivot: string): void {
        warnOncePerSystem(
          facts,
          `resolver-pivot|${selfNamespace}|${pivot}`,
          () => {
            const hint =
              pivot === "self"
                ? 'write "ctx.facts.x" instead of "ctx.facts.self.x"'
                : `read "ctx.deps.${pivot}.x" instead of "ctx.facts.${pivot}.x"`;

            return `[Directive] Module "${selfNamespace}": resolvers read their own facts flat from ctx.facts and other modules from ctx.deps. Found "ctx.facts.${pivot}" – it still works, but ${hint}.`;
          },
        );
      }

      return createHardenedProxy<Record<string, unknown>>({
        get: (prop) => {
          if (pivots && prop === "self") {
            warnLegacy("self");

            return own;
          }
          if (depNamesSet.has(prop)) {
            warnLegacy(prop);

            return resolverDepView(facts, selfNamespace, prop);
          }

          return own[prop];
        },
        set: (prop, value) => {
          own[prop] = value;

          return true;
        },
        has: (prop) =>
          (pivots && prop === "self") || depNamesSet.has(prop) || prop in own,
        delete: (prop) => Reflect.deleteProperty(own, prop),
        ownKeys: () => Object.keys(own),
      });
    },
  );
}

// ============================================================================
// Source Gate Facts Proxy
// ============================================================================

/** Cache of source gate proxies, per facts store then `self|deps`. */
const gateProxyCache: ProxyCache = new WeakMap();

/** Throw for any write – a source gate is a pure read of facts. */
function rejectGateWrite(selfNamespace: string, key: string): never {
  throw new Error(
    `[Directive] Module "${selfNamespace}": a source's key/active gate wrote "${key}". Gates are pure reads of facts; change facts from an event handler or resolver.`,
  );
}

/**
 * Create the facts view a source's `key` / `active` gate receives in a
 * namespaced system.
 *
 * Same scoping as the module's constraints: bare own-module keys
 * (`facts.running`), or `facts.self.*` / `facts.{dep}.*` when the module
 * declares crossModuleDeps. The view is read-only and throws on write.
 *
 * Before 1.35 gates received the whole flat store (`facts["loop::running"]`),
 * so that spelling keeps working here – reads of a key containing `::` fall
 * through to the flat store and warn once per system in development.
 *
 * Proxies are cached per facts store, so evaluating gates on every
 * reconcile allocates nothing after the first pass.
 *
 * @internal
 */
export function createSourceGateFactsProxy(
  facts: Record<string, unknown>,
  selfNamespace: string,
  depNamespaces: string[] | null,
): Record<string, unknown> {
  return cachedProxy(
    gateProxyCache,
    facts,
    `${selfNamespace}|${depNamespaces ? depNamespaces.join(",") : "-"}`,
    () => buildSourceGateFactsProxy(facts, selfNamespace, depNamespaces),
  );
}

function buildSourceGateFactsProxy(
  facts: Record<string, unknown>,
  selfNamespace: string,
  depNamespaces: string[] | null,
): Record<string, unknown> {
  const gateView = (namespace: string) =>
    createReadonlyModuleFactsView(
      facts,
      namespace,
      `gate|${selfNamespace}|${namespace}`,
      (key) => rejectGateWrite(selfNamespace, key),
    );
  const own = gateView(selfNamespace);
  const depNamesSet = depNamespaces ? new Set(depNamespaces) : null;

  function readFlat(prop: string): unknown {
    warnOncePerSystem(facts, `gate-flat|${selfNamespace}|${prop}`, () => {
      const bare = prop.slice(prop.indexOf(SEPARATOR) + SEPARATOR.length);
      const isOwn = prop.startsWith(`${selfNamespace}${SEPARATOR}`);
      const spelling = isOwn
        ? depNamesSet
          ? `facts.self.${bare}`
          : `facts.${bare}`
        : `facts.${prop.slice(0, prop.indexOf(SEPARATOR))}.${bare} (declare it in crossModuleDeps)`;

      return `[Directive] Module "${selfNamespace}": a source gate read "${prop}" from the flat store. Gates receive the module's own facts; use ${spelling}. The flat form still works.`;
    });

    return facts[prop];
  }

  if (!depNamesSet) {
    return createHardenedProxy<Record<string, unknown>>({
      get: (prop) => (prop.includes(SEPARATOR) ? readFlat(prop) : own[prop]),
      set: (prop) => rejectGateWrite(selfNamespace, prop),
      delete: (prop) => rejectGateWrite(selfNamespace, prop),
      has: (prop) => (prop.includes(SEPARATOR) ? prop in facts : prop in own),
      ownKeys: () => Object.keys(own),
    });
  }

  const allKeys = ["self", ...depNamesSet];

  return createHardenedProxy<Record<string, unknown>>({
    get: (prop) => {
      if (prop === "self") {
        return own;
      }
      if (depNamesSet.has(prop)) {
        return gateView(prop);
      }
      if (prop.includes(SEPARATOR)) {
        return readFlat(prop);
      }
      // Same advice the constraint proxy gives: with crossModuleDeps the
      // module's own facts live under `self`.
      if (!RUNTIME_PROBE_PROPS.has(prop)) {
        warnOncePerSystem(
          facts,
          `gate-undeclared|${selfNamespace}|${prop}`,
          () =>
            `[Directive] Module "${selfNamespace}" read undeclared property "${prop}" in a source gate. This module declares crossModuleDeps, so gate facts are namespaced: use "facts.self.${prop}" for its own fact, or add the module to crossModuleDeps.`,
        );
      }

      return undefined;
    },
    set: (prop) => rejectGateWrite(selfNamespace, prop),
    delete: (prop) => rejectGateWrite(selfNamespace, prop),
    has: (prop) => prop === "self" || depNamesSet.has(prop),
    ownKeys: () => allKeys,
  });
}

// ============================================================================
// Module Derive Proxy
// ============================================================================

/**
 * Create a proxy for a single module's derivations.
 * Translates unprefixed keys to prefixed: `status` → `auth::status`
 *
 * Proxies are cached per derive store and namespace for performance.
 *
 * @param derive - The flat derivations store
 * @param namespace - The module namespace for key prefixing
 * @returns A read-only proxy that translates property access to prefixed keys
 *
 * @internal
 */
export function createModuleDeriveProxy(
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

  const prefix = `${namespace}${SEPARATOR}`;

  const proxy = createHardenedProxy<Record<string, unknown>>({
    get: (prop) => derive[`${prefix}${prop}`],
    has: (prop) => `${prefix}${prop}` in derive,
    // The flat store is keyed `ns::name` across every module in the system, so
    // enumeration has to filter to this namespace and hand back bare names —
    // otherwise spreading a module's `derived` would leak sibling modules' keys
    // in their encoded form, which is both a scoping break and unreadable.
    //
    // `has` above only became answerable when the flat derive proxy gained its
    // own `has` trap; before that it delegated to a bare `{}` target and
    // reported `false` for every key that existed.
    ownKeys: () =>
      Object.keys(derive)
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length)),
  });

  namespaceCache.set(namespace, proxy);

  return proxy;
}

// ============================================================================
// Namespaced Derive Proxy
// ============================================================================

/**
 * Create a nested proxy for namespaced derivations access.
 * `derive.auth.status` → reads `auth::status` from flat derive
 *
 * Uses Set for O(1) namespace lookups and caches the outer proxy.
 *
 * @param derive - The flat derivations store
 * @param modulesMap - Map of module namespaces to module definitions
 * @param getModuleNames - Function returning current module names
 * @returns A read-only proxy that delegates to per-module derive proxies
 *
 * @internal
 */
/**
 * Keys a runtime probes on any object it is handed, which are not user typos.
 *
 * React 19's dev mode walks objects looking for these; so do serializers and
 * promise-detection paths. Warning about them would fire on every render and
 * teach the reader to ignore the channel.
 */
const RUNTIME_PROBE_PROPS: ReadonlySet<string> = Object.freeze(
  new Set([
    "$$typeof",
    "toJSON",
    "then",
    "nodeType",
    "tagName",
    "hasAttribute",
    "asymmetricMatch",
    "Symbol(Symbol.toStringTag)",
    "@@__IMMUTABLE_ITERABLE__@@",
    "@@__IMMUTABLE_RECORD__@@",
  ]),
);

/**
 * Names already warned about, per derive store.
 *
 * Per store rather than per process: a second system in the same process is a
 * second chance to make this mistake, and deserves to hear about it. Keyed
 * weakly so the record dies with the system it describes.
 */
const warnedDerivationReads = new WeakMap<object, Set<string>>();

/**
 * Say something when `system.derive.total` is reached for in a composed system.
 *
 * In `createSystem({ module })` the derivations sit directly on `system.derive`.
 * In `createSystem({ modules })` that same position holds *module names*, and
 * the derivations are one level down. So the identical read returns `undefined`
 * once the module is composed — the gate goes falsy, the constraint never fires,
 * and nothing is written anywhere.
 *
 * Constraints and effects receive `derived` as a parameter now, which removes
 * the reason to reach back at all. But nothing was taken away: every module
 * written before that still contains the read, and upgrading surfaces exactly
 * none of them. This is the line that does.
 *
 * Only on the miss path, only in development, once per name. The scan is over
 * the flat derive keys and only runs when a key resolved to no module, which in
 * a correct program happens for runtime probes and nothing else.
 */
function warnDerivationReadAsModule(
  derive: Record<string, unknown>,
  requested: string,
  getModuleNames: () => string[],
): void {
  if (RUNTIME_PROBE_PROPS.has(requested) || requested.startsWith("@@")) {
    return;
  }
  let warned = warnedDerivationReads.get(derive);
  if (warned === undefined) {
    warned = new Set<string>();
    warnedDerivationReads.set(derive, warned);
  }
  if (warned.has(requested)) {
    return;
  }

  const suffix = `${SEPARATOR}${requested}`;
  const owners: string[] = [];
  for (const key of Object.keys(derive)) {
    if (key.endsWith(suffix)) {
      owners.push(key.slice(0, key.length - suffix.length));
    }
  }

  if (owners.length === 0) {
    return;
  }

  warned.add(requested);

  const owner = owners[0];
  const where =
    owners.length === 1
      ? `module "${owner}"`
      : `modules ${owners.map((n) => `"${n}"`).join(", ")}`;

  console.warn(
    `[Directive] system.derive.${requested} is undefined — "${requested}" is a derivation of ${where}, not a module. This system was built with createSystem({ modules }), where system.derive holds module names and the derivations are one level down. Inside a constraint or effect, read the \`derived\` parameter instead: \`when: (facts, derived) => derived.${requested}\`. Outside one, use system.derive.${owner}.${requested}. This system's modules are: ${getModuleNames().join(", ")}.`,
  );
}

export function createNamespacedDeriveProxy(
  derive: Record<string, unknown>,
  modulesMap: ModulesMap,
  getModuleNames: () => string[],
): Record<string, Record<string, unknown>> {
  // Check cache first
  const cached = namespacedDeriveProxyCache.get(derive);
  if (cached) {
    return cached;
  }

  const proxy = createHardenedProxy<Record<string, Record<string, unknown>>>({
    get: (namespace) => {
      if (!Object.hasOwn(modulesMap, namespace)) {
        if (isDevelopment) {
          warnDerivationReadAsModule(derive, namespace, getModuleNames);
        }

        return undefined;
      }

      return createModuleDeriveProxy(derive, namespace);
    },
    has: (namespace) => Object.hasOwn(modulesMap, namespace),
    ownKeys: () => getModuleNames(),
  });

  namespacedDeriveProxyCache.set(derive, proxy);

  return proxy;
}

// ============================================================================
// Namespaced Events Proxy
// ============================================================================

/**
 * Create a nested proxy for namespaced events access.
 * `events.auth.login({ token })` → dispatches `{ type: "auth::login", token }`
 *
 * Uses Set for O(1) namespace lookups and caches proxies for performance.
 *
 * @param engine - The engine instance (used for dispatch)
 * @param modulesMap - Map of module namespaces to module definitions
 * @param getModuleNames - Function returning current module names
 * @returns A read-only proxy that returns event dispatcher functions per namespace
 *
 * @internal
 */
export function createNamespacedEventsProxy(
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

  return createHardenedProxy<
    Record<string, Record<string, (payload?: Record<string, unknown>) => void>>
  >({
    get: (namespace) => {
      if (!Object.hasOwn(modulesMap, namespace)) {
        return undefined;
      }

      // Check cache for this namespace's event proxy
      const cached = namespaceCache!.get(namespace);
      if (cached) {
        return cached;
      }

      // Create and cache the module events proxy
      const moduleEventsProxy = createHardenedProxy<
        Record<string, (payload?: Record<string, unknown>) => void>
      >({
        get: (eventName) => {
          return (payload?: Record<string, unknown>) => {
            engine.dispatch({
              type: `${namespace}${SEPARATOR}${eventName}`,
              ...payload,
            });
          };
        },
      });

      namespaceCache!.set(namespace, moduleEventsProxy);

      return moduleEventsProxy;
    },
    has: (namespace) => Object.hasOwn(modulesMap, namespace),
    ownKeys: () => getModuleNames(),
  });
}

// ============================================================================
// Key Conversion Helpers
// ============================================================================

/**
 * Convert a namespaced key (e.g., "auth.status") to internal prefixed format ("auth::status").
 * If the key is already in prefixed format, returns it unchanged.
 *
 * @param key - The key to convert (dot-separated or already prefixed)
 * @returns The internal prefixed key
 *
 * @example
 * toInternalKey("auth.status") // → "auth::status"
 * toInternalKey("auth::status") // → "auth::status" (unchanged)
 * toInternalKey("status")      // → "status" (unchanged)
 *
 * @internal
 */
export function toInternalKey(key: string): string {
  // If key contains a dot, convert to separator format
  if (key.includes(".")) {
    const [namespace, ...rest] = key.split(".");

    return `${namespace}${SEPARATOR}${rest.join(SEPARATOR)}`;
  }
  // Already in internal format or simple key

  return key;
}

// ============================================================================
// Snapshot Helpers
// ============================================================================

/**
 * Convert flat internal keys (e.g., `"auth::token"`) to nested namespaced
 * format (e.g., `{ auth: { token: ... } }`).
 *
 * Keys without a separator are grouped under `_root`.
 *
 * @param flatData - Object with internal prefixed keys
 * @returns Nested object grouped by namespace
 *
 * @internal
 */
export function denormalizeFlatKeys(
  flatData: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [key, value] of Object.entries(flatData)) {
    const sepIndex = key.indexOf(SEPARATOR);
    if (sepIndex > 0) {
      const ns = key.slice(0, sepIndex);
      const local = key.slice(sepIndex + SEPARATOR.length);
      if (!result[ns]) {
        result[ns] = {};
      }
      result[ns][local] = value;
    } else {
      if (!result._root) {
        result._root = {};
      }
      result._root[key] = value;
    }
  }

  return result;
}
