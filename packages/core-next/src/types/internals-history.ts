/**
 * Copied from 1.35 (packages/core/src/utils/history.ts): its exported type
 * declarations only, unchanged. Types, no runtime code.
 */

import type {
  Facts,
  FactsStore,
  HistoryAPI,
  HistoryOption,
  Schema,
  Snapshot,
} from "./index.js";

// ============================================================================
// History Manager
// ============================================================================

/**
 * Internal history manager that extends the public {@link HistoryAPI}
 * with snapshot capture, restoration, and pause/resume controls.
 *
 * @remarks
 * - `takeSnapshot(trigger)` records the current facts into the ring buffer.
 * - `restore(snapshot)` deserializes a snapshot back into the facts store,
 *   marking itself as restoring for the duration.
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
  /**
   * Re-capture the newest snapshot from the current facts, in place.
   *
   * For writes that finish the work of the pass that took it (an event an
   * effect dispatched): they belong in that snapshot, not in one of their own,
   * so undo lands on a settled state. A no-op unless the newest snapshot is the
   * current one.
   */
  refreshLatestSnapshot(): void;
  /** Restore facts from a snapshot */
  restore(snapshot: Snapshot): void;
  /** Check if history is enabled */
  readonly isEnabled: boolean;
  /**
   * True while a snapshot is being restored.
   *
   * Informational. The engine does not read it: whether a write reconciles,
   * and whether the pass it schedules is safe to snapshot or to re-evaluate
   * gated sources with, are decided per write from the scope the manager runs
   * its own assignments in. A flag covering the whole navigation answered for
   * writes that were not the manager's — a listener reacting to a rewind is
   * doing the program's own work — and it was still up during the flush where
   * those reactions run.
   */
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
  /**
   * Runs the manager's own fact assignments in whatever scope marks a write as
   * replayed. Supplied by the engine; defaults to running `fn` unchanged so a
   * standalone manager still works.
   */
  withRestoreOrigin?: (fn: () => void) => void;
  /**
   * Runs a whole navigation in whatever scope marks it as one — wider than
   * {@link withRestoreOrigin}, which covers only the manager's own writes.
   *
   * A listener that writes while rewinding is doing the program's own work and
   * its write reconciles like any other, but the pass it schedules must not
   * take a snapshot over the redo stack or re-open a gated transport.
   */
  withNavigation?: (fn: () => void) => void;
}
