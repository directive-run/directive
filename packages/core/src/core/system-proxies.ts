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
import { BLOCKED_PROPS } from "./tracking.js";
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
 * Create a proxy with consistent security hardening.
 *
 * Every proxy created by this factory includes:
 * - Symbol access returns `undefined`
 * - BLOCKED_PROPS (`__proto__`, `constructor`, `prototype`) rejected
 * - `defineProperty` returns `false`
 * - `getPrototypeOf` returns `null`
 * - `setPrototypeOf` returns `false`
 *
 * @internal
 */
function createHardenedProxy<T extends object>(config: HardenedProxyConfig): T {
  return new Proxy({} as T, {
    get(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
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
  // biome-ignore lint/suspicious/noExplicitAny: Engine type for cache key
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
      facts[`${namespace}${SEPARATOR}${prop}`] = value;

      return true;
    },
    has: (prop) => `${namespace}${SEPARATOR}${prop}` in facts,
    delete: (prop) => {
      delete facts[`${namespace}${SEPARATOR}${prop}`];

      return true;
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
): Record<string, Record<string, unknown>> {
  // depNamespaces comes from Object.keys() which has stable order per module,
  // so join is sufficient (no need to sort)
  const cacheKey = `${selfNamespace}|${depNamespaces.join(",")}`;

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
    has: (key) => key === "self" || depNamesSet.has(key),
    ownKeys: () => allKeys,
  });

  namespaceCache.set(cacheKey, proxy);

  return proxy;
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

  const proxy = createHardenedProxy<Record<string, unknown>>({
    get: (prop) => derive[`${namespace}${SEPARATOR}${prop}`],
    has: (prop) => `${namespace}${SEPARATOR}${prop}` in derive,
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
