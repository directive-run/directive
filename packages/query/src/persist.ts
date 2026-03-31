/**
 * Query Cache Persistence – Save and restore query cache to a Storage backend.
 *
 * Persists `_q_*_state` and `_q_*_key` facts so query data survives page
 * reloads. Stale data is served immediately on restore, then revalidated
 * in the background (stale-while-revalidate).
 *
 * @example
 * ```typescript
 * import { createQuerySystem } from "@directive-run/query";
 * import { persistQueryCache } from "@directive-run/query";
 *
 * const app = createQuerySystem({
 *   facts: { userId: "" },
 *   queries: { user: { key: (f) => ({ id: f.userId }), fetcher: fetchUser } },
 *   plugins: [
 *     persistQueryCache({
 *       storage: localStorage,
 *       key: "my-app-query-cache",
 *     }),
 *   ],
 * });
 * ```
 *
 * @module
 */

import { PREFIX } from "./internal.js";

// ============================================================================
// Types
// ============================================================================

/** Storage backend interface – compatible with Web Storage API. */
export interface QueryCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Configuration for {@link persistQueryCache}. */
export interface PersistQueryCacheOptions {
  /** A Storage-compatible backend (localStorage, sessionStorage, or custom). */
  storage: QueryCacheStorage;

  /** The key used to read/write from storage. */
  key: string;

  /**
   * Query names to persist. Default: all queries.
   * @example ["user", "todos"]
   */
  include?: string[];

  /**
   * Query names to exclude from persistence.
   * @example ["notifications"] // don't persist ephemeral queries
   */
  exclude?: string[];

  /** Milliseconds to debounce saves. Default: 250. */
  debounce?: number;

  /**
   * Maximum age (ms) of persisted data before it's discarded on restore.
   * Default: Infinity (no expiry).
   */
  maxAge?: number;

  /** Callback after cache is restored from storage. */
  onRestore?: (queryCount: number) => void;

  /** Callback after cache is saved to storage. */
  onSave?: (queryCount: number) => void;

  /** Callback when a load or save error occurs. */
  onError?: (error: Error) => void;
}

/** Shape of the persisted cache in storage. */
interface PersistedCache {
  version: 1;
  savedAt: number;
  queries: Record<
    string,
    {
      state: Record<string, unknown>;
      key: unknown;
    }
  >;
}

// ============================================================================
// Helpers
// ============================================================================

const STATE_SUFFIX = "_state";
const KEY_SUFFIX = "_key";

/** Check if a fact key is a query state key */
function isQueryStateKey(factKey: string): boolean {
  return factKey.startsWith(PREFIX) && factKey.endsWith(STATE_SUFFIX);
}

/** Extract query name from a _q_{name}_state key */
function extractName(factKey: string): string {
  return factKey.slice(PREFIX.length, -STATE_SUFFIX.length);
}

/** Check if a query name passes include/exclude filters */
function shouldPersist(
  name: string,
  include?: string[],
  exclude?: string[],
): boolean {
  if (exclude?.includes(name)) {
    return false;
  }
  if (include && !include.includes(name)) {
    return false;
  }

  return true;
}

// ============================================================================
// Plugin
// ============================================================================

/**
 * Create a plugin that persists query cache to a Storage backend.
 *
 * On system init, restores cached query data as `initialFacts`.
 * On every query state change, schedules a debounced save.
 * On system destroy, performs a final synchronous save.
 *
 * Restored data is marked with the original `dataUpdatedAt` timestamp,
 * so queries with `refetchAfter` will detect staleness and revalidate.
 *
 * @param options - {@link PersistQueryCacheOptions}
 * @returns A plugin object compatible with `createSystem`'s `plugins` array.
 */
// biome-ignore lint/suspicious/noExplicitAny: Plugin type varies by system schema
export function persistQueryCache(options: PersistQueryCacheOptions): any {
  const {
    storage,
    key,
    include,
    exclude,
    debounce: debounceMs = 250,
    maxAge = Number.POSITIVE_INFINITY,
    onRestore,
    onSave,
    onError,
  } = options;

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  /** Read persisted cache from storage */
  function loadCache(): PersistedCache | null {
    try {
      const raw = storage.getItem(key);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        parsed.version !== 1 ||
        typeof parsed.savedAt !== "number" ||
        typeof parsed.queries !== "object"
      ) {
        return null;
      }

      // Check maxAge
      if (Date.now() - parsed.savedAt > maxAge) {
        storage.removeItem?.(key);

        return null;
      }

      return parsed as PersistedCache;
    } catch (err) {
      onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );

      return null;
    }
  }

  /** Save current query states to storage */
  // biome-ignore lint/suspicious/noExplicitAny: System type varies
  function saveCache(system: any): void {
    if (destroyed) {
      return;
    }

    try {
      const queries: PersistedCache["queries"] = {};
      let count = 0;

      // Read all _q_*_state facts from the store
      const facts =
        typeof system.facts?.$store?.toObject === "function"
          ? system.facts.$store.toObject()
          : {};

      for (const factKey of Object.keys(facts)) {
        if (!isQueryStateKey(factKey)) {
          continue;
        }

        const name = extractName(factKey);
        if (!shouldPersist(name, include, exclude)) {
          continue;
        }

        const state = facts[factKey] as Record<string, unknown> | undefined;
        if (!state || state.status === "pending") {
          continue; // Don't persist queries that never succeeded
        }

        queries[name] = {
          state: { ...state, isFetching: false, isPending: false },
          key: facts[`${PREFIX}${name}${KEY_SUFFIX}`] ?? null,
        };
        count++;
      }

      const cache: PersistedCache = {
        version: 1,
        savedAt: Date.now(),
        queries,
      };

      storage.setItem(key, JSON.stringify(cache));
      onSave?.(count);
    } catch (err) {
      onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  /** Schedule a debounced save */
  // biome-ignore lint/suspicious/noExplicitAny: System type varies
  function scheduleSave(system: any): void {
    if (destroyed) {
      return;
    }
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveCache(system);
    }, debounceMs);
  }

  // biome-ignore lint/suspicious/noExplicitAny: System ref stored for save
  let systemRef: any = null;

  return {
    name: "query-cache-persistence",

    // biome-ignore lint/suspicious/noExplicitAny: System type varies
    onInit: (system: any) => {
      systemRef = system;

      // Restore cached query states
      const cache = loadCache();
      if (!cache) {
        return;
      }

      let count = 0;
      for (const [name, entry] of Object.entries(cache.queries)) {
        if (!shouldPersist(name, include, exclude)) {
          continue;
        }

        const stateKey = `${PREFIX}${name}${STATE_SUFFIX}`;
        const keyKey = `${PREFIX}${name}${KEY_SUFFIX}`;

        // Restore state – mark as stale so queries revalidate
        const restoredState = {
          ...entry.state,
          isStale: true,
        };

        try {
          system.facts.$store.set(stateKey, restoredState);
          if (entry.key !== null && entry.key !== undefined) {
            system.facts.$store.set(keyKey, entry.key);
          }
          count++;
        } catch {
          // Key may not exist in schema – skip silently
        }
      }

      onRestore?.(count);
    },

    onFactSet: (factKey: string) => {
      if (
        typeof factKey === "string" &&
        factKey.startsWith(PREFIX) &&
        systemRef
      ) {
        scheduleSave(systemRef);
      }
    },

    onFactsBatch: () => {
      if (systemRef) {
        scheduleSave(systemRef);
      }
    },

    onDestroy: () => {
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      // Final synchronous save before marking destroyed
      if (systemRef) {
        saveCache(systemRef);
      }
      destroyed = true;
      systemRef = null;
    },
  };
}
