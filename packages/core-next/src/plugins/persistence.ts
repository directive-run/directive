/**
 * The persistence plugin (L6b): 1.35's `plugins/persistence.ts`, with what
 * it writes to storage kept byte for byte: the storage key, the JSON format,
 * which facts and in what key order, the debounce (`clearTimeout` then
 * `setTimeout` per write, as 1.35, C list), the final save on destroy, and
 * `onRestore`, `onSave` and `onError`. A save reads each fact through the
 * facts view, so a development Date read still throws there and only
 * `onError` hears (P6, (aj) declined).
 *
 * Two owner-approved changes for 2.0 (RFC L6, 2026-11-02):
 * - (ai) the plugin reads storage at `onInit`, as 1.35, but applies what it
 *   read inside `initialize()`, after the module inits and before
 *   `initialFacts` and hydrate. An init that sets a persisted fact no longer
 *   overwrites the saved value, and the saved value is not in the facts
 *   until `initialize()`. Until then a save writes the saved values it holds,
 *   so nothing saved is lost, and a key the program writes itself before
 *   `initialize()` is the program's, as in 1.35.
 * - (ak) a saved key the schema no longer has is skipped, with one
 *   development warning, so an app update that removes a fact does not stop
 *   the restore (1.35 development) or keep saving the stale key (1.35
 *   production).
 *
 * The plugin reaches its system's context (the flat facts view, the
 * "hydrate" batch, the schema) through the module-private {@link scopes},
 * as 1.35's plugin reaches its hydration scope. On a system without one (a
 * test double) it restores at `onInit`, exactly as 1.35 does there.
 */

import isDevelopment from "#is-development";
import type { SystemContext } from "../api/core.js";
import { isPrototypeSafe } from "../api/facts.js";
import { scopes } from "../api/plugins.js";
import type { Plugin, System } from "../api/types.js";

/**
 * Configuration for the {@link persistencePlugin}, as 1.35's.
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
  /** Callback fired after state is restored from storage. */
  onRestore?: (data: Record<string, unknown>) => void;
  /** Callback fired after state is written to storage. */
  onSave?: (data: Record<string, unknown>) => void;
  /** Callback fired when a load or save error occurs. */
  onError?: (error: Error) => void;
}

type Rec = Record<string, unknown>;

/**
 * Create a plugin that persists selected facts to a `Storage` backend and
 * restores them when the system initializes.
 *
 * @example
 * ```ts
 * const system = createSystem({
 *   module: myModule,
 *   plugins: [persistencePlugin({ storage: localStorage, key: "my-app" })],
 * });
 * ```
 */
export function persistencePlugin(options: PersistencePluginOptions): Plugin {
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
  let system: System | null = null;
  /** The system's context; null on a system this package did not build. */
  let context: SystemContext | null = null;
  /** Saved values read at onInit and not yet applied ((ai)), in storage order. */
  let pending: Map<string, unknown> | null = null;
  const trackedKeys = new Set<string>();

  /** Check if a key should be persisted */
  const shouldPersist = (factKey: string): boolean => {
    if (exclude.includes(factKey)) {
      return false;
    }
    if (include) {
      return include.includes(factKey);
    }

    return true;
  };

  /** The facts view: flat `ns::key` keys on a namespaced system, as 1.35's engine. */
  const facts = (): Rec => (context ? context.facts : system!.facts) as Rec;

  /** Load state from storage */
  const load = (): Rec | null => {
    try {
      const json = storage.getItem(key);
      if (!json) {
        return null;
      }

      const data = JSON.parse(json);
      if (typeof data !== "object" || data === null) {
        return null;
      }

      // Security: Check for prototype pollution
      if (!isPrototypeSafe(data)) {
        onError?.(
          new Error("Potential prototype pollution detected in stored data"),
        );

        return null;
      }

      return data as Rec;
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));

      return null;
    }
  };

  /** The persisted entries of `data`, without the keys the schema dropped (ak). */
  const entriesOf = (data: Rec): [string, unknown][] => {
    const schema = context?.module.schema?.facts as Rec | undefined;
    // An empty schema declares nothing, so nothing in it is stale (as restore()).
    const known =
      schema && Object.keys(schema).length > 0
        ? (factKey: string) => Object.hasOwn(schema, factKey)
        : () => true;
    const stale: string[] = [];
    const entries = Object.entries(data).filter(([factKey]) => {
      if (!shouldPersist(factKey)) {
        return false;
      }
      if (!known(factKey)) {
        stale.push(factKey);

        return false;
      }

      return true;
    });
    if (isDevelopment && stale.length > 0) {
      console.warn(
        `[Directive] persistence: skipped saved keys the schema no longer has: ${stale.join(", ")}. The next save leaves them out.`,
      );
    }

    return entries;
  };

  /** Write `entries` in one batch filed as hydration, then onRestore (1.35's onInit). */
  const restore = (data: Rec, entries: Iterable<[string, unknown]>) => {
    const write = () => {
      for (const [factKey, value] of entries) {
        facts()[factKey] = value;
        trackedKeys.add(factKey);
      }
    };
    if (context) {
      context.load_(write);
    } else {
      // A system this package did not build — a test double, in practice.
      // Restore anyway rather than lose the user's state, but say so, as 1.35.
      (
        system!.facts as { $store: { batch(fn: () => void): void } }
      ).$store.batch(() => {
        console.error(
          "[Directive] persistence: no hydration scope on this system, so restored values are recorded as first-party writes rather than as hydration.",
        );
        write();
      });
    }
    onRestore?.(data);
  };

  /** (ai): the plugin's turn inside initialize(), after the module inits. */
  const turn = (data: Rec) => {
    const held = pending;
    pending = null;
    if (!held) {
      return;
    }
    try {
      restore(data, held);
    } catch (error) {
      // What 1.35's plugin manager logs when this restore throws in onInit.
      console.error("[Directive] Plugin error:", {
        plugin: "persistence",
        hook: "onInit",
        error,
      });
      // Keys the throw left unwritten, and nothing else wrote, are not
      // tracked, as 1.35 never tracked them.
      for (const factKey of held.keys()) {
        if (!context!.store.has(factKey)) {
          trackedKeys.delete(factKey);
        }
      }
    }
  };

  /** A key the program writes before initialize() is its own, as in 1.35. */
  const written = (factKey: string) => {
    if (pending && !context!.init_) {
      pending.delete(factKey);
    }
  };

  /** Save state to storage */
  const save = () => {
    if (!system) {
      return;
    }

    try {
      const data: Rec = {};
      const view = facts();

      for (const factKey of trackedKeys) {
        if (shouldPersist(factKey)) {
          // Saved but not applied yet (ai): the saved value stands.
          data[factKey] = pending?.has(factKey)
            ? pending.get(factKey)
            : view[factKey];
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

    onInit: (sys: System) => {
      system = sys;
      context = scopes.get(sys) ?? null;

      // Restore state from storage
      const data = load();
      if (!data) {
        return;
      }
      const entries = entriesOf(data);
      if (context && !sys.isInitialized) {
        // (ai): held for the turn. Tracked now, as 1.35 tracks a restored
        // key here, so each save writes the keys in 1.35's order.
        for (const [factKey] of entries) {
          trackedKeys.add(factKey);
        }
        pending = new Map(entries);
        const ctx = context;
        const before = ctx.turn_;
        ctx.turn_ = () => {
          before?.();
          turn(data);
        };

        return;
      }
      // Initialized already (a plugin whose onInit came after initialize()),
      // or no context: now, as 1.35.
      restore(data, entries);
    },

    onDestroy: () => {
      // Final save before destroy
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      save();
    },

    onFactSet: (factKey: string) => {
      trackedKeys.add(factKey);
      written(factKey);
      if (shouldPersist(factKey)) {
        scheduleSave();
      }
    },

    onFactDelete: (factKey: string) => {
      trackedKeys.delete(factKey);
      written(factKey);
      if (shouldPersist(factKey)) {
        scheduleSave();
      }
    },

    onFactsBatch: (changes: { key: string; type: string }[]) => {
      let shouldSave = false;
      for (const change of changes) {
        if (change.type === "set") {
          trackedKeys.add(change.key);
        } else {
          trackedKeys.delete(change.key);
        }
        written(change.key);
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
