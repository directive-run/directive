/**
 * History (L8a, L8b), as a system part: 1.35's `history:` option, with no import.
 * `createSystem` wires it on every system (L8 RFC, A1, O1); `createSystemCore`
 * and the floor go without it. With the option off it creates nothing: no
 * buffer, no listener set; `system.history` is null and `onHistoryChange`
 * adds a listener nothing calls (1.35 engine.ts:2605, 4343–4348).
 *
 * The manager is 1.35's (utils/history.ts). The core keeps the seam
 * (core.ts): the pass asks `history_` for its one snapshot, folds an effect
 * chain's writes into the last, and carries the navigation rules. A restore
 * writes through the facts in one store batch filed as "restore", inside the
 * core's navigation frame, so its keys wake effects alone.
 *
 * Six owner-approved changes from 1.35 (L8 RFC rev 2, 2026-11-10, "Approve
 * all as recommended (Recommended)"):
 * - (ay) a navigation puts back the pause it found (1.35 clears it);
 * - (az) `replay()` and `import()` call `onHistoryNavigate` and the
 *   `onHistoryChange` listeners, as `goTo` does (1.35 tells neither);
 * - (ba) after an import the next id follows the highest imported id;
 * - (bc) an import whose `currentIndex` is outside the list fails, as any bad
 *   field does, and changes nothing;
 * - (be) `goBack` and `goForward` take each step in turn: a step from inside
 *   a changeset lands on its edge, the start rule (an earlier changeset that
 *   ends within the steps left) is one arm, and any other step moves one
 *   snapshot (1.35 takes one jump and drops the steps left);
 * - (bb) the changesets follow the snapshots (see `takeSnapshot`): 1.35 keeps a
 *   range's indexes when the buffer drops snapshots, when a new snapshot
 *   cuts off redo, and across an import;
 * - (bd) a stored snapshot is not shared (see `keep` and `restore`): a
 *   restore writes copies, and each stored snapshot and its `facts` record
 *   are frozen (1.35's `snapshots` list and restores hand out the stored
 *   objects, T8).
 */

import isDevelopment from "#is-development";
import type { Snapshot } from "../types/index.js";
import type { SystemPart } from "./core.js";
import { DEV_PROXY_TARGET, isPrototypeSafe } from "./facts.js";

type Rec = Record<string, unknown>;

/** Keys reported uncapturable, once per key per process (1.35). */
const reported = new Set<string>();

/** 1.35's unwrapDevProxies: the development read-back wrappers, deep. */
const unwrap = (value: unknown, seen = new WeakSet()): unknown => {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const source = ((value as Rec)[DEV_PROXY_TARGET as never] ?? value) as Rec;
  if (seen.has(source)) {
    return source;
  }
  seen.add(source);
  if (Array.isArray(source)) {
    return source.map((item) => unwrap(item, seen));
  }
  // A Date, Map, Set or any other non-plain object is kept whole.
  if (Object.getPrototypeOf(source) !== Object.prototype) {
    return source;
  }
  const out: Rec = {};
  for (const [key, item] of Object.entries(source)) {
    out[key] = unwrap(item, seen);
  }

  return out;
};

/**
 * (bd): each copy a restore wrote, to the stored value it was cloned from,
 * so restoring that value again finds its copy still live (see `restore`).
 */
const twins = new WeakMap<object, unknown>();

/**
 * (bd): a stored snapshot and its `facts` record are frozen, shallow: what
 * they hold is not (freezing deep would walk every value). Its `facts` is a
 * record the clone made (or the import parsed), never one the app holds.
 */
const keep = (snapshot: Snapshot) => {
  Object.freeze(snapshot.facts);

  return Object.freeze(snapshot);
};

/** A recorded range (its label is never read, so not kept). */
interface Changeset {
  start_: number;
  end_: number;
}

export const withHistory =
  (
    option:
      | boolean
      | {
          maxSnapshots?: number;
          redactSnapshot?: (facts: Rec) => Rec;
        }
      | undefined,
  ): SystemPart =>
  (context) => {
    const { system, store, facts, wants_: wants, emit_: emit } = context;
    if (!option) {
      system.history = null;
      system.onHistoryChange = () => () => {};

      return;
    }
    // `true` destructures as an object with neither key.
    const { maxSnapshots = 100, redactSnapshot } = option as Exclude<
      typeof option,
      boolean
    >;
    const snapshots: Snapshot[] = [];
    let changesets: Changeset[] = [];
    const listeners = new Set<() => void>();
    let index = -1;
    let nextId = 1;
    let paused = false;
    let restoring = false;
    // The open changeset's start (its label is never read): Infinity when
    // none is open, so no index passes it, its end records nothing, and a
    // shift or a cut leaves it Infinity.
    let pendingStart = Number.POSITIVE_INFINITY;
    // 1.35's destroy drops the listeners (engine.ts:3498).
    const notify = () => {
      for (const listener of context.gone_ ? [] : listeners) {
        listener();
      }
    };

    /** The four clone tiers, after the redactor (utils/history.ts:206–304). */
    const serialize = (): Rec => {
      let raw: Rec = store.toObject();
      if (redactSnapshot) {
        try {
          raw = redactSnapshot(raw);
        } catch (error) {
          console.warn(
            "[Directive] history.redactSnapshot threw, snapshot stored raw",
            { error },
          );
        }
      }
      try {
        return structuredClone(raw);
      } catch {
        // Per key, below.
      }
      const out: Rec = {};
      const lost: string[] = [];
      for (const [key, value] of Object.entries(raw)) {
        try {
          out[key] = structuredClone(value);
          continue;
        } catch {
          // The next tier.
        }
        if (isDevelopment) {
          try {
            out[key] = structuredClone(unwrap(value));
            continue;
          } catch {
            // The next tier.
          }
        }
        try {
          out[key] = JSON.parse(JSON.stringify(value));
        } catch {
          lost.push(key);
        }
      }
      const fresh = lost.filter((key) => !reported.has(key));
      if (fresh.length > 0) {
        for (const key of fresh) {
          reported.add(key);
        }
        console.warn(
          `[Directive] These facts cannot be captured in history and are omitted from snapshots: ${fresh.join(", ")}. Restoring leaves them at their current values. A fact holding a function, a live handle, or another value that cannot be cloned cannot take part in time travel.`,
        );
      }

      return out;
    };

    const takeSnapshot = (trigger: string): Snapshot => {
      if (paused) {
        return { id: -1, timestamp: Date.now(), facts: {}, trigger };
      }
      const snapshot = keep({
        id: nextId++,
        timestamp: Date.now(),
        facts: serialize(),
        trigger,
      });
      // A snapshot taken after a goBack cuts off every one ahead of it.
      const at = index;
      snapshots.splice(index + 1);
      index = snapshots.push(snapshot) - 1;
      while (snapshots.length > maxSnapshots) {
        snapshots.shift();
        index--;
      }
      // (bb): the ranges follow the snapshots. The cut above dropped the
      // ones after `at`: a range that starts past it is dropped, and one that
      // only ends past it is cut back to it (the RFC drops a range only when
      // its start goes). The `k` dropped from the front shift every range; a
      // range whose start fell off is dropped, as is one left with no step.
      // A range that began before the first snapshot (start -1) is kept until
      // a drop, as in 1.35. The open changeset (begun, not ended) is dropped
      // by the same rules, so its end records nothing; otherwise its start
      // moves with the snapshot it named.
      const k = at + 1 - index;
      changesets = changesets.filter(
        (c) =>
          (c.start_ -= k) < (c.end_ = Math.min(c.end_, at) - k) &&
          (c.start_ >= 0 || !k),
      );
      if (pendingStart > at || (k && (pendingStart -= k) < 0)) {
        pendingStart = Number.POSITIVE_INFINITY;
      }
      if (wants("history.snapshot")) {
        emit("history.snapshot", { snapshot });
      }
      notify();

      return snapshot;
    };

    /** T3: an effect chain's writes finish the pass that caused them. */
    const refreshLatestSnapshot = () => {
      if (!paused && index >= 0 && index === snapshots.length - 1) {
        snapshots[index] = keep({ ...snapshots[index]!, facts: serialize() });
      }
    };

    const restore = (snapshot: Snapshot) => {
      // (ay): the pause the restore found is put back.
      const was = paused;
      paused = restoring = true;
      try {
        context.nav_(() => {
          const values = snapshot.facts as Rec;
          if (!isPrototypeSafe(values)) {
            console.error(
              "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
            );

            return;
          }
          // 1.35 skips a dangerous key here too, with a warning; the check
          // above has refused any such key, so none reaches the writes.
          // (bd): a stored snapshot's objects reach the facts as copies, never
          // themselves (a primitive needs none). Capture and import store only
          // values that clone, so no copy throws partway. A snapshot the
          // caller built is written as given, as in 1.35 (a class instance
          // keeps its prototype; a value that cannot clone still restores).
          // A live value that is already a copy of this very stored value is
          // written back as it is, so it is no change: 1.35 writes the stored
          // object it already holds, and runs no pass. The live values are
          // read as the snapshot reads them, with no dependency tracked.
          const stored = snapshots.includes(snapshot);
          const live = store.toObject();
          context.load_(() => {
            for (const [key, value] of Object.entries(values)) {
              let next = value;
              if (
                stored &&
                Object(value) === value &&
                twins.get((next = live[key]) as object) !== value
              ) {
                twins.set((next = structuredClone(value)) as object, value);
              }
              (facts as Rec)[key] = next;
            }
          }, "restore");
        });
      } finally {
        paused = was;
        restoring = false;
      }
    };

    /**
     * Restore index `to` and tell 1.35's onHistoryChange option (the hook,
     * through the core's stream, so it still fires after destroy), then the
     * listeners.
     */
    const move = (from: number, to: number) => {
      index = to;
      const snapshot = snapshots[to];
      if (snapshot) {
        restore(snapshot);
        if (wants("history.navigate")) {
          emit("history.navigate", { from, to });
        }
        notify();
      }
    };

    /** The changeset `at` is inside of, by `inside`; undefined when none. */
    const find = (inside: (c: Changeset) => boolean) => changesets.find(inside);

    const history = {
      get isEnabled() {
        return true;
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
        return index;
      },
      takeSnapshot,
      refreshLatestSnapshot,
      restore,
      goBack(steps = 1) {
        let to = index;
        // (be): each step in turn, while there is one to take.
        for (let left = steps; left > 0 && to > 0; left--) {
          const at = to;
          const inside = find((c) => at > c.start_ && at <= c.end_);
          if (inside) {
            to = inside.start_;
            continue;
          }
          // 1.35's start rule (utils/history.ts:442–453), kept as one arm.
          const earlier =
            find((c) => at === c.start_) &&
            find((c) => c.end_ < at && at - c.end_ <= left);
          if (earlier) {
            to = earlier.start_;
            break;
          }
          to--;
        }
        if (to !== index) {
          move(index, to);
        }
      },
      goForward(steps = 1) {
        let to = index;
        for (let left = steps; left > 0 && to < snapshots.length - 1; left--) {
          const at = to;
          to = find((c) => at >= c.start_ && at < c.end_)?.end_ ?? at + 1;
        }
        if (to !== index) {
          move(index, to);
        }
      },
      goTo(snapshotId: number) {
        const to = snapshots.findIndex((s) => s.id === snapshotId);
        if (to < 0) {
          console.warn(`[Directive] Snapshot ${snapshotId} not found`);

          return;
        }
        move(index, to);
      },
      replay() {
        // (az): told as goTo tells.
        if (snapshots.length > 0) {
          move(index, 0);
        }
      },
      export: () =>
        JSON.stringify({ version: 1, snapshots, currentIndex: index }),
      import(json: string) {
        try {
          const data = JSON.parse(json);
          if (typeof data !== "object" || data === null) {
            throw new Error(
              "[Directive] Invalid history data: expected object",
            );
          }
          if (data.version !== 1) {
            throw new Error(
              `[Directive] Unsupported history export version: ${data.version}`,
            );
          }
          if (!Array.isArray(data.snapshots)) {
            throw new Error(
              "[Directive] Invalid history data: snapshots must be an array",
            );
          }
          if (typeof data.currentIndex !== "number") {
            throw new Error(
              "Invalid history data: currentIndex must be a number",
            );
          }
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
            if (!isPrototypeSafe(snap.facts)) {
              throw new Error(
                "[Directive] Invalid fact data: potential prototype pollution detected in nested objects",
              );
            }
          }
          // (bc): the index must name a snapshot in the list.
          if (!data.snapshots[data.currentIndex]) {
            throw new Error(
              "[Directive] Invalid history data: currentIndex must be the index of a snapshot",
            );
          }
          snapshots.splice(0, snapshots.length, ...data.snapshots.map(keep));
          // (bb): the old ranges, and the open changeset, index the old list.
          changesets = [];
          pendingStart = Number.POSITIVE_INFINITY;
          // (ba): new ids follow the highest imported one.
          for (const snap of snapshots) {
            nextId = Math.max(nextId, snap.id + 1);
          }
          // (az): told as goTo tells.
          move(index, data.currentIndex);
        } catch (error) {
          console.error("[Directive] Failed to import history data:", error);
        }
      },
      beginChangeset() {
        pendingStart = index;
      },
      endChangeset() {
        if (index > pendingStart) {
          changesets.push({ start_: pendingStart, end_: index });
        }
        pendingStart = Number.POSITIVE_INFINITY;
      },
      pause() {
        paused = true;
      },
      resume() {
        paused = false;
      },
    };
    system.history = history;
    system.onHistoryChange = (listener: () => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    };
    const names = (
      context.module.history as { snapshotEvents?: string[] } | undefined
    )?.snapshotEvents;
    context.history_ = {
      events_: names ? new Set(names) : null,
      snap_: (label) => (label ? takeSnapshot(label) : refreshLatestSnapshot()),
    };
  };
