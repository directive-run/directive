/**
 * 1.35's `createHistoryManager` and `createDisabledHistory`
 * (utils/history.ts), for `./internals`. Imported by that entry alone, so
 * the main entry carries none of it.
 *
 * The manager is the `withHistory` part's (history.ts), not a copy, so the
 * approved rows (ay), (az), (ba), (bb), (bc), (bd) and (be) apply to it as
 * they do to `system.history`. The part runs on a context built from 1.35's
 * options: `withNavigation` is its `nav_`, a store batch around
 * `withRestoreOrigin` is its `load_` (1.35 batches the restore's writes and
 * scopes only the assignments), and `onSnapshot` and `onHistoryChange` take
 * the `history.snapshot` and `history.navigate` records it emits.
 */

import type { Schema, Snapshot } from "../types/index.js";
import type {
  CreateHistoryOptions,
  HistoryManager,
} from "../types/internals-history.js";
import type { SystemContext } from "./core.js";
import { withHistory } from "./history.js";

const run = (fn: () => void) => fn();

/**
 * Create a snapshot-based history manager backed by a ring buffer.
 *
 * @param options - History config, facts proxy, store, and optional snapshot/history callbacks.
 * @returns A {@link HistoryManager} with snapshot capture, navigation, changeset, and export/import methods.
 *
 * @internal
 */
export function createHistoryManager<S extends Schema>(
  options: CreateHistoryOptions<S>,
): HistoryManager<S> {
  const {
    historyOption,
    facts,
    store,
    onSnapshot,
    onHistoryChange,
    withRestoreOrigin = run,
    withNavigation = run,
  } = options;
  if (!historyOption) {
    // 1.35's manager with history off: inert, except that pause and resume
    // still set `isPaused` and `export` writes the empty history.
    let paused = false;

    return {
      ...createDisabledHistory<S>(),
      get isPaused() {
        return paused;
      },
      pause() {
        paused = true;
      },
      resume() {
        paused = false;
      },
      export: () =>
        JSON.stringify({ version: 1, snapshots: [], currentIndex: -1 }),
    };
  }
  const system = {} as { history: HistoryManager<S> };
  withHistory(historyOption)({
    system,
    store,
    facts,
    module: {},
    gone_: false,
    wants_: () => true,
    emit_: (
      at: string,
      data: { snapshot: Snapshot; from: number; to: number },
    ) =>
      at === "history.snapshot"
        ? onSnapshot?.(data.snapshot)
        : onHistoryChange?.(data.from, data.to),
    nav_: withNavigation,
    load_: (fn: () => void) => store.batch(() => withRestoreOrigin(fn)),
  } as unknown as SystemContext);

  return system.history;
}

/**
 * Create a no-op history manager for use when history is disabled.
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
    refreshLatestSnapshot: () => {},
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
