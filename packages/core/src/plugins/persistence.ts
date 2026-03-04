/**
 * Persistence Plugin - Save/restore facts to storage
 */

import type { ModuleSchema, Plugin, System } from "../core/types.js";
import { isPrototypeSafe } from "../utils/utils.js";

/**
 * Configuration for the {@link persistencePlugin}.
 *
 * @remarks
 * At minimum, provide a `storage` backend and a `key`. Use `include` or
 * `exclude` to control which fact keys are persisted. Saves are debounced
 * by default (100 ms) to avoid excessive writes during rapid updates.
 *
 * | Field       | Default | Description |
 * |-------------|---------|-------------|
 * | `storage`   | *(required)* | A `Storage`-compatible backend (`localStorage`, `sessionStorage`, or custom). |
 * | `key`       | *(required)* | The key used to read/write from storage. |
 * | `include`   | all keys | Whitelist of fact keys to persist. |
 * | `exclude`   | `[]`    | Blacklist of fact keys to skip. |
 * | `debounce`  | `100`   | Milliseconds to debounce saves. |
 * | `onRestore` | --      | Callback fired after state is restored from storage. |
 * | `onSave`    | --      | Callback fired after state is written to storage. |
 * | `onError`   | --      | Callback fired when a load or save error occurs. |
 *
 * @public
 */
export interface PersistencePluginOptions {
  /** A `Storage`-compatible backend (`localStorage`, `sessionStorage`, or custom). */
  storage: Storage;
  /** The key used to read/write from the storage backend. */
  key: string;
  /** Whitelist of fact keys to persist (default: all keys). */
  include?: string[];
  /** Fact keys to exclude from persistence. */
  exclude?: string[];
  /** Milliseconds to debounce saves (default: 100). */
  debounce?: number;
  /** Callback fired after state is restored from storage on init. */
  onRestore?: (data: Record<string, unknown>) => void;
  /** Callback fired after state is written to storage. */
  onSave?: (data: Record<string, unknown>) => void;
  /** Callback fired when a load or save error occurs. */
  onError?: (error: Error) => void;
}

/**
 * Create a plugin that persists selected facts to a `Storage` backend and
 * restores them on system init.
 *
 * @remarks
 * On `onInit`, the plugin reads the storage key and batch-sets any persisted
 * facts into the store. On every `onFactSet` / `onFactDelete` / `onFactsBatch`,
 * a debounced save is scheduled. A final synchronous save runs on `onDestroy`
 * to capture any pending changes.
 *
 * Stored data is validated against prototype pollution before restoration
 * via {@link isPrototypeSafe}.
 *
 * @param options - Required {@link PersistencePluginOptions} specifying storage backend, key, and optional filters/callbacks.
 * @returns A {@link Plugin} that can be passed to `createSystem`'s `plugins` array.
 *
 * @example
 * ```ts
 * const system = createSystem({
 *   modules: [myModule],
 *   plugins: [
 *     persistencePlugin({
 *       storage: localStorage,
 *       key: "my-app-state",
 *       include: ["user", "preferences"],
 *     }),
 *   ],
 * });
 * ```
 *
 * @public
 */
export function persistencePlugin<M extends ModuleSchema = ModuleSchema>(
  options: PersistencePluginOptions,
): Plugin<M> {
  const {
    storage,
    key,
    include,
    exclude = [],
    debounce = 100,
    onRestore,
    onSave,
    onError,
  } = options;

  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let system: System<M> | null = null;
  const trackedKeys = new Set<string>();

  /** Check if a key should be persisted */
  const shouldPersist = (factKey: string): boolean => {
    if (exclude.includes(factKey)) return false;
    if (include) return include.includes(factKey);
    return true;
  };

  /** Load state from storage */
  const load = (): Record<string, unknown> | null => {
    try {
      const json = storage.getItem(key);
      if (!json) return null;

      const data = JSON.parse(json);
      if (typeof data !== "object" || data === null) return null;

      // Security: Check for prototype pollution
      if (!isPrototypeSafe(data)) {
        onError?.(
          new Error("Potential prototype pollution detected in stored data"),
        );
        return null;
      }

      return data as Record<string, unknown>;
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  };

  /** Save state to storage */
  const save = () => {
    if (!system) return;

    try {
      const data: Record<string, unknown> = {};

      for (const factKey of trackedKeys) {
        if (shouldPersist(factKey)) {
          data[factKey] = (system.facts as Record<string, unknown>)[factKey];
        }
      }

      storage.setItem(key, JSON.stringify(data));
      onSave?.(data);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  /** Schedule a debounced save */
  const scheduleSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(save, debounce);
  };

  return {
    name: "persistence",

    onInit: (sys) => {
      system = sys;

      // Restore state from storage
      const data = load();
      if (data) {
        system.facts.$store.batch(() => {
          for (const [factKey, value] of Object.entries(data)) {
            if (shouldPersist(factKey)) {
              (system!.facts as Record<string, unknown>)[factKey] = value;
              trackedKeys.add(factKey);
            }
          }
        });
        onRestore?.(data);
      }
    },

    onDestroy: () => {
      // Final save before destroy
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      save();
    },

    onFactSet: (factKey) => {
      trackedKeys.add(factKey);
      if (shouldPersist(factKey)) {
        scheduleSave();
      }
    },

    onFactDelete: (factKey) => {
      trackedKeys.delete(factKey);
      if (shouldPersist(factKey)) {
        scheduleSave();
      }
    },

    onFactsBatch: (changes) => {
      let shouldSave = false;
      for (const change of changes) {
        if (change.type === "set") {
          trackedKeys.add(change.key);
        } else {
          trackedKeys.delete(change.key);
        }
        if (shouldPersist(change.key)) {
          shouldSave = true;
        }
      }
      if (shouldSave) {
        scheduleSave();
      }
    },
  };
}
