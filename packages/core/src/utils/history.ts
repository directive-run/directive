/**
 * History — Snapshot-based state history
 *
 * Features:
 * - Ring buffer of state snapshots
 * - Go back/forward through history
 * - Replay from any snapshot
 * - Export/import state history
 */

import type {
  Facts,
  FactsStore,
  HistoryAPI,
  HistoryOption,
  Schema,
  Snapshot,
} from "../core/types.js";
import { isPrototypeSafe } from "./utils.js";

// ============================================================================
// History Manager
// ============================================================================

/**
 * A changeset groups multiple snapshots into a single undo/redo unit.
 *
 * @remarks
 * Use {@link HistoryManager.beginChangeset} and
 * {@link HistoryManager.endChangeset} to create changesets. When navigating
 * with `goBack`/`goForward`, the entire changeset is traversed as one step.
 *
 * @internal
 */
export interface Changeset {
  label: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Internal history manager that extends the public {@link HistoryAPI}
 * with snapshot capture, restoration, and pause/resume controls.
 *
 * @remarks
 * - `takeSnapshot(trigger)` records the current facts into the ring buffer.
 * - `restore(snapshot)` deserializes a snapshot back into the facts store,
 *   setting `isRestoring = true` so the engine skips reconciliation.
 * - `pause()` / `resume()` temporarily suspend snapshot recording (e.g.,
 *   during bulk imports or programmatic state resets).
 * - `beginChangeset(label)` / `endChangeset()` group consecutive snapshots
 *   so `goBack`/`goForward` treat them as a single undo/redo unit.
 *
 * @typeParam _S - The schema type (unused at runtime but preserved for type safety).
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface HistoryManager<_S extends Schema> extends HistoryAPI {
  /** Take a snapshot of current state */
  takeSnapshot(trigger: string): Snapshot;
  /** Restore facts from a snapshot */
  restore(snapshot: Snapshot): void;
  /** Check if history is enabled */
  readonly isEnabled: boolean;
  /** True while restoring a snapshot (engine should skip reconciliation) */
  readonly isRestoring: boolean;
  /** Pause snapshot taking */
  pause(): void;
  /** Resume snapshot taking */
  resume(): void;
}

/**
 * Options for creating a history manager via {@link createHistoryManager}.
 *
 * @typeParam S - The facts schema type.
 *
 * @internal
 */
export interface CreateHistoryOptions<S extends Schema> {
  historyOption: HistoryOption;
  facts: Facts<S>;
  store: FactsStore<S>;
  /** Callback when a snapshot is taken */
  onSnapshot?: (snapshot: Snapshot) => void;
  /** Callback when history navigation occurs */
  onHistoryChange?: (from: number, to: number) => void;
}

/**
 * Resolve a HistoryOption (boolean | HistoryConfig) into concrete values.
 * @internal
 */
function resolveHistoryOption(option: HistoryOption): {
  enabled: boolean;
  maxSnapshots: number;
} {
  if (typeof option === "boolean") {
    return { enabled: option, maxSnapshots: 100 };
  }

  // Object config — presence implies enabled
  return {
    enabled: true,
    maxSnapshots: option.maxSnapshots ?? 100,
  };
}

/**
 * Create a snapshot-based history manager backed by a ring buffer.
 *
 * @remarks
 * Snapshots are taken automatically after fact changes (during reconciliation)
 * and can be navigated with `goBack`/`goForward`/`goTo`. Use
 * `beginChangeset(label)` and `endChangeset()` to group multiple snapshots
 * into a single undo/redo unit. The entire history can be exported to JSON
 * via `export()` and re-imported with `import()` for cross-session debugging.
 *
 * Call `pause()` to temporarily stop recording snapshots (e.g., during bulk
 * fact imports) and `resume()` to re-enable recording.
 *
 * @param options - History config, facts proxy, store, and optional snapshot/history callbacks.
 * @returns A {@link HistoryManager} with snapshot capture, navigation, changeset, and export/import methods.
 *
 * @internal
 */
export function createHistoryManager<S extends Schema>(
  options: CreateHistoryOptions<S>,
): HistoryManager<S> {
  const { historyOption, facts, store, onSnapshot, onHistoryChange } = options;

  const { enabled: isEnabled, maxSnapshots } =
    resolveHistoryOption(historyOption);

  // Ring buffer of snapshots
  const snapshots: Snapshot[] = [];
  let currentIndex = -1;
  let nextId = 1;
  let paused = false;
  let restoring = false;

  // Changeset tracking
  const changesets: Changeset[] = [];
  let pendingChangesetLabel: string | null = null;
  let pendingChangesetStart = -1;

  /** Get current facts as a plain object */
  function getCurrentFacts(): Record<string, unknown> {
    return store.toObject();
  }

  /** Serialize facts to a snapshot-friendly format */
  function serializeFacts(): Record<string, unknown> {
    const factsObj = getCurrentFacts();

    // Deep clone to prevent mutation
    try {
      return structuredClone(factsObj);
    } catch {
      // Fallback for non-cloneable values (functions, DOM nodes, etc.)
      try {
        return JSON.parse(JSON.stringify(factsObj));
      } catch {
        return { ...factsObj };
      }
    }
  }

  /** Deserialize and restore facts from a snapshot */
  function deserializeFacts(serialized: Record<string, unknown>): void {
    // Validate entire object tree for prototype pollution
    if (!isPrototypeSafe(serialized)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }

    store.batch(() => {
      for (const [key, value] of Object.entries(serialized)) {
        // Prototype pollution protection (redundant but defensive)
        if (
          key === "__proto__" ||
          key === "constructor" ||
          key === "prototype"
        ) {
          console.warn(
            `[Directive] Skipping dangerous key "${key}" during fact restoration`,
          );
          continue;
        }
        // @ts-expect-error - dynamic key access
        facts[key] = value;
      }
    });
  }

  const manager: HistoryManager<S> = {
    get isEnabled() {
      return isEnabled;
    },

    get isRestoring() {
      return restoring;
    },

    get isPaused() {
      return paused;
    },

    get snapshots() {
      return [...snapshots];
    },

    get currentIndex() {
      return currentIndex;
    },

    takeSnapshot(trigger: string): Snapshot {
      if (!isEnabled || paused) {
        return { id: -1, timestamp: Date.now(), facts: {}, trigger };
      }

      const snapshot: Snapshot = {
        id: nextId++,
        timestamp: Date.now(),
        facts: serializeFacts(),
        trigger,
      };

      // If we're not at the end, truncate future snapshots
      if (currentIndex < snapshots.length - 1) {
        snapshots.splice(currentIndex + 1);
      }

      // Add new snapshot
      snapshots.push(snapshot);
      currentIndex = snapshots.length - 1;

      // Enforce max size (ring buffer)
      while (snapshots.length > maxSnapshots) {
        snapshots.shift();
        currentIndex--;
      }

      onSnapshot?.(snapshot);
      return snapshot;
    },

    restore(snapshot: Snapshot): void {
      if (!isEnabled) return;

      // Set restoring flag so the engine skips reconciliation scheduling.
      // The restored state is already "reconciled" — it was captured after
      // a complete reconcile cycle. Re-reconciling would create spurious
      // snapshots that break undo/redo navigation.
      paused = true;
      restoring = true;

      try {
        deserializeFacts(snapshot.facts);
      } finally {
        paused = false;
        restoring = false;
      }
    },

    goBack(steps = 1): void {
      if (!isEnabled || snapshots.length === 0) return;

      const fromIndex = currentIndex;

      // Check if we're inside a changeset — jump to its start
      let toIndex = currentIndex;
      const cs = changesets.find(
        (c) => currentIndex > c.startIndex && currentIndex <= c.endIndex,
      );
      if (cs) {
        toIndex = cs.startIndex;
      } else {
        // Check if we're at the end of a changeset — jump past its start
        const prevCs = changesets.find((c) => currentIndex === c.startIndex);
        if (prevCs) {
          // We're at the boundary. Look for the changeset before this one.
          const earlierCs = changesets.find(
            (c) =>
              c.endIndex < currentIndex && currentIndex - c.endIndex <= steps,
          );
          toIndex = earlierCs
            ? earlierCs.startIndex
            : Math.max(0, currentIndex - steps);
        } else {
          toIndex = Math.max(0, currentIndex - steps);
        }
      }

      if (fromIndex === toIndex) return;

      currentIndex = toIndex;
      const snapshot = snapshots[currentIndex];
      if (snapshot) {
        this.restore(snapshot);
        onHistoryChange?.(fromIndex, toIndex);
      }
    },

    goForward(steps = 1): void {
      if (!isEnabled || snapshots.length === 0) return;

      const fromIndex = currentIndex;

      // Check if we're inside or at the start of a changeset — jump to its end
      let toIndex = currentIndex;
      const cs = changesets.find(
        (c) => currentIndex >= c.startIndex && currentIndex < c.endIndex,
      );
      if (cs) {
        toIndex = cs.endIndex;
      } else {
        toIndex = Math.min(snapshots.length - 1, currentIndex + steps);
      }

      if (fromIndex === toIndex) return;

      currentIndex = toIndex;
      const snapshot = snapshots[currentIndex];
      if (snapshot) {
        this.restore(snapshot);
        onHistoryChange?.(fromIndex, toIndex);
      }
    },

    goTo(snapshotId: number): void {
      if (!isEnabled) return;

      const index = snapshots.findIndex((s) => s.id === snapshotId);
      if (index === -1) {
        console.warn(`[Directive] Snapshot ${snapshotId} not found`);
        return;
      }

      const fromIndex = currentIndex;
      currentIndex = index;
      const snapshot = snapshots[currentIndex];
      if (snapshot) {
        this.restore(snapshot);
        onHistoryChange?.(fromIndex, index);
      }
    },

    replay(): void {
      if (!isEnabled || snapshots.length === 0) return;

      // Start from the beginning
      currentIndex = 0;
      const snapshot = snapshots[0];
      if (snapshot) {
        this.restore(snapshot);
      }
    },

    export(): string {
      return JSON.stringify({
        version: 1,
        snapshots,
        currentIndex,
      });
    },

    import(json: string): void {
      if (!isEnabled) return;

      try {
        const data = JSON.parse(json);

        // Validate import data structure to prevent prototype pollution
        if (typeof data !== "object" || data === null) {
          throw new Error("[Directive] Invalid history data: expected object");
        }
        if (data.version !== 1) {
          throw new Error(
            `[Directive] Unsupported history export version: ${data.version}`,
          );
        }
        if (!Array.isArray(data.snapshots)) {
          throw new Error("[Directive] Invalid history data: snapshots must be an array");
        }
        if (typeof data.currentIndex !== "number") {
          throw new Error(
            "Invalid history data: currentIndex must be a number",
          );
        }

        // Validate each snapshot has required properties
        for (const snap of data.snapshots) {
          if (typeof snap !== "object" || snap === null) {
            throw new Error("[Directive] Invalid snapshot: expected object");
          }
          if (
            typeof snap.id !== "number" ||
            typeof snap.timestamp !== "number" ||
            typeof snap.trigger !== "string" ||
            typeof snap.facts !== "object"
          ) {
            throw new Error("Invalid snapshot structure");
          }
          // Deep check for prototype pollution attacks (including nested objects)
          if (!isPrototypeSafe(snap.facts)) {
            throw new Error(
              "[Directive] Invalid fact data: potential prototype pollution detected in nested objects",
            );
          }
        }

        snapshots.length = 0;
        snapshots.push(...data.snapshots);
        currentIndex = data.currentIndex;

        // Restore current state
        const snapshot = snapshots[currentIndex];
        if (snapshot) {
          this.restore(snapshot);
        }
      } catch (error) {
        console.error("[Directive] Failed to import history data:", error);
      }
    },

    beginChangeset(label: string): void {
      if (!isEnabled) return;
      pendingChangesetLabel = label;
      pendingChangesetStart = currentIndex;
    },

    endChangeset(): void {
      if (!isEnabled || pendingChangesetLabel === null) return;
      if (currentIndex > pendingChangesetStart) {
        changesets.push({
          label: pendingChangesetLabel,
          startIndex: pendingChangesetStart,
          endIndex: currentIndex,
        });
      }
      pendingChangesetLabel = null;
      pendingChangesetStart = -1;
    },

    pause(): void {
      paused = true;
    },

    resume(): void {
      paused = false;
    },
  };

  return manager;
}

/**
 * Create a no-op history manager for use when history is disabled.
 *
 * @remarks
 * All methods are safe to call but perform no work. This avoids null-checks
 * throughout the engine -- callers can use the same {@link HistoryManager}
 * interface regardless of whether history is enabled.
 *
 * @returns A {@link HistoryManager} where every method is a no-op and `isEnabled` is `false`.
 *
 * @internal
 */
export function createDisabledHistory<S extends Schema>(): HistoryManager<S> {
  const noopSnapshot: Snapshot = {
    id: -1,
    timestamp: 0,
    facts: {},
    trigger: "",
  };

  return {
    isEnabled: false,
    isRestoring: false,
    isPaused: false,
    snapshots: [],
    currentIndex: -1,
    takeSnapshot: () => noopSnapshot,
    restore: () => {},
    goBack: () => {},
    goForward: () => {},
    goTo: () => {},
    replay: () => {},
    export: () => "{}",
    import: () => {},
    beginChangeset: () => {},
    endChangeset: () => {},
    pause: () => {},
    resume: () => {},
  };
}
