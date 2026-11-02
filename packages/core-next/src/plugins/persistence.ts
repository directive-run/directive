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
 * - (ak) a saved key the schema no longer has is not restored, with one
 *   development warning, so an app update that removes a fact does not stop
 *   the restore (1.35 development). In production every save writes it back
 *   unchanged, in its place, so an app rolled back to an older version keeps
 *   the value and storage holds 1.35 production's bytes (owner, 2026-11-02:
 *   "Keep them in storage"). In development a save leaves it out, as 1.35's
 *   development save does, since 1.35 development stops its restore at such a
 *   key and a rollback would lose the keys after it (owner, 2026-11-02: "Drop
 *   stale keys in dev"). `include` and `exclude` apply to it as to any key.
 *
 * The plugin reaches its system's context (the flat facts view, the
 * "hydrate" batch, the schema) through the module-private {@link scopes},
 * as 1.35's plugin reaches its hydration scope. On a system without one (a
 * test double) it restores at `onInit`, exactly as 1.35 does there.
 *
 * One instance on several systems: what 1.35 keeps per instance stays per
 * instance (the debounce timer, the tracked keys, and the system a save
 * reads, the one `onInit` saw last); the held saved data and the turn are
 * each system's own.
 */

import isDevelopment from "#is-development";
import type { SystemContext } from "../api/core.js";
import { isPrototypeSafe } from "../api/facts.js";
import { scopes } from "../api/plugins.js";
import type { ModuleSchema, Plugin, System } from "../api/types.js";
import type { KernelEvent } from "../kernel.js";
import type {
  ModuleSchema as ModuleSchema135,
  Plugin as Plugin135,
} from "../types/index.js";

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
export function persistencePlugin<M extends ModuleSchema135 = ModuleSchema135>(
  options: PersistencePluginOptions,
): Plugin135<M>;
/** @internal The implementation, on core-next's own Plugin type. */
export function persistencePlugin<M extends ModuleSchema = ModuleSchema>(
  options: PersistencePluginOptions,
): Plugin {
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
  /** Each system's saved values read at onInit and not yet applied ((ai)), in storage order. */
  const held = new WeakMap<object, Map<string, unknown>>();
  /** Each system's saved values the schema no longer has (ak): not restored; production saves write them back. */
  const kept = new WeakMap<object, Map<string, unknown>>();
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
  const facts = (sys: System<M>): Rec =>
    (scopes.get(sys)?.facts ?? sys.facts) as Rec;

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

  /**
   * The persisted entries of `data`, in storage order. The keys the schema
   * dropped stay among them, so they are tracked in their place, and go to
   * `kept` for `sys`: not restored (ak); production writes them back on every
   * save, development leaves them out, as each 1.35 build does.
   */
  const entriesOf = (
    sys: System<M>,
    data: Rec,
    context: SystemContext | undefined,
  ): [string, unknown][] => {
    const schema = context?.module.schema?.facts as Rec | undefined;
    const stale = new Map<string, unknown>();
    const entries = Object.entries(data).filter(([factKey]) =>
      shouldPersist(factKey),
    );
    // An empty schema declares nothing, so nothing in it is stale (as restore()).
    if (schema && Object.keys(schema).length > 0) {
      for (const [factKey, value] of entries) {
        if (!Object.hasOwn(schema, factKey)) {
          stale.set(factKey, value);
        }
      }
    }
    if (stale.size > 0) {
      kept.set(sys, stale);
      if (isDevelopment) {
        console.warn(
          `[Directive] persistence: skipped saved keys the schema no longer has: ${[...stale.keys()].join(", ")}. The next save drops them.`,
        );
      }
    }

    return entries;
  };

  /** Write `entries` in one batch filed as hydration, then onRestore (1.35's onInit). */
  const restore = (
    sys: System<M>,
    data: Rec,
    entries: Iterable<[string, unknown]>,
  ) => {
    const context = scopes.get(sys);
    const stale = kept.get(sys);
    const write = () => {
      for (const [factKey, value] of entries) {
        if (!stale?.has(factKey)) {
          facts(sys)[factKey] = value;
        }
        trackedKeys.add(factKey);
      }
    };
    if (context) {
      context.load_(write);
    } else {
      // A system this package did not build — a test double, in practice.
      // Restore anyway rather than lose the user's state, but say so, as 1.35.
      (
        sys.facts as unknown as { $store: { batch(fn: () => void): void } }
      ).$store.batch(() => {
        console.error(
          "[Directive] persistence: no hydration scope on this system, so restored values are recorded as first-party writes rather than as hydration.",
        );
        write();
      });
    }
    if (stale) {
      if (isDevelopment) {
        // 1.35 development writes no stale key, so only the keys written
        // schedule a save there, through the hooks, as here.
      } else {
        // 1.35 production restores a stale key, and that write schedules a save.
        scheduleSave();
      }
    }
    onRestore?.(data);
  };

  /** (ai): `sys`'s turn inside initialize(), after the module inits. */
  const turn = (sys: System<M>, data: Rec, saved: Map<string, unknown>) => {
    held.delete(sys);
    try {
      restore(sys, data, saved);
    } catch (error) {
      // What 1.35's plugin manager logs when this restore throws in onInit.
      console.error("[Directive] Plugin error:", {
        plugin: "persistence",
        hook: "onInit",
        error,
      });
      // Keys the throw left unwritten, and nothing else wrote, are not
      // tracked, as 1.35 never tracked them; a kept key (ak) stays.
      for (const factKey of saved.keys()) {
        if (
          !scopes.get(sys)!.store.has(factKey) &&
          !kept.get(sys)?.has(factKey)
        ) {
          trackedKeys.delete(factKey);
        }
      }
    }
  };

  /** Save state to storage */
  const save = () => {
    if (!system) {
      return;
    }

    try {
      const data: Rec = {};
      const view = facts(system);
      const saved = held.get(system);
      const stale = kept.get(system);

      for (const factKey of trackedKeys) {
        if (shouldPersist(factKey)) {
          // Development leaves out a kept key (ak) the program has not set
          // itself, as 1.35's development save does (owner, 2026-11-02:
          // "Drop stale keys in dev"), so a rollback to 1.35 in development
          // restores every key. Production writes it back, below.
          if (
            isDevelopment &&
            stale?.has(factKey) &&
            !scopes.get(system)!.store.has(factKey)
          ) {
            continue;
          }
          // Saved but not applied yet (ai): the saved value stands. A kept
          // key (ak) is written back unchanged in production, unless the
          // program has since set it itself (production allows an unknown key).
          data[factKey] = saved?.has(factKey)
            ? saved.get(factKey)
            : stale?.has(factKey) && !scopes.get(system)!.store.has(factKey)
              ? stale.get(factKey)
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

    onInit: (sys: System<M>) => {
      system = sys;
      const context = scopes.get(sys);

      // Restore state from storage
      const data = load();
      if (!data) {
        return;
      }
      const entries = entriesOf(sys, data, context);
      if (context && !sys.isInitialized) {
        // (ai): held for the turn. Tracked now, as 1.35 tracks a restored
        // key here, so each save writes the keys in 1.35's order, and in
        // production a kept key (ak) in its place.
        for (const [factKey] of entries) {
          trackedKeys.add(factKey);
        }
        const saved = new Map(entries);
        held.set(sys, saved);
        // A key the program writes on this system before initialize() is
        // its own, as in 1.35. This system's records only: the hooks below
        // do not say which system wrote. Reads no kind of its own (wants_),
        // so it builds no record that was not built anyway.
        const off = context.kernel.hooks.on(
          Object.assign(
            (event: KernelEvent) => {
              if (
                !context.init_ &&
                event.sys === context.kernel.id &&
                event.at.startsWith("fact.")
              ) {
                for (const change of (event.changes ?? [event]) as {
                  key: string;
                }[]) {
                  saved.delete(change.key);
                }
              }
            },
            { wants_: () => false },
          ),
        );
        const before = context.turn_;
        context.turn_ = () => {
          before?.();
          off();
          turn(sys, data, saved);
        };

        return;
      }
      // Initialized already (a plugin whose onInit came after initialize()),
      // or no context: now, as 1.35.
      restore(sys, data, entries);
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
      if (shouldPersist(factKey)) {
        scheduleSave();
      }
    },

    onFactDelete: (factKey: string) => {
      trackedKeys.delete(factKey);
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
