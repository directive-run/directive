/**
 * Record everything a system does that anyone outside it can observe, as one
 * ordered trace of plain JSON:
 *
 * - every plugin hook, in call order, with its arguments (`hook`);
 * - every `system.observe()` event (`observe`);
 * - every store notification, per fact key and derivation (`notify`);
 * - at each checkpoint, every fact, every derivation's value and the whole
 *   `inspect()` result (`state`);
 * - whatever the scenario's own definitions report about the outside world,
 *   such as an effect's side effect (`external`);
 * - every console message the engine prints, dev warnings included
 *   (`console`; the scenario runner captures them);
 * - every promise rejection nobody handled during the run (`unhandled`);
 * - each step the scenario takes, and anything a step threw (`step`, `threw`).
 *
 * The plugin has to be installed when the system is created (hooks fire from
 * `createSystem`), so recording is two calls: `createRecorder()` for the
 * plugin, then `record(system, { recorder })` once the system exists.
 *
 * A checkpoint reads every derivation, which computes the ones nobody read
 * yet. Both engines get the same reads at the same points, so the comparison
 * stays fair; the trace is what a reader at those points sees, not what a
 * purely passive observer would.
 */

import { type HookName, PLUGIN_HOOKS, SYSTEM_HOOKS } from "./hooks.js";
import { type Json, normalize } from "./normalize.js";

export type TraceEntry =
  | { k: "hook"; hook: HookName; args: Json[] }
  | { k: "observe"; event: Json }
  | { k: "notify"; id: string }
  | { k: "state"; label: string; facts: Json; derived: Json; inspect: Json }
  | { k: "external"; data: Json }
  | { k: "console"; level: string; args: Json[] }
  | { k: "unhandled"; error: Json }
  | { k: "step"; i: number; step: Json }
  | { k: "threw"; where: string; error: Json };

/** The parts of a system the recorder touches (both engines satisfy it). */
export interface RecordableSystem {
  observe(observer: (event: unknown) => void): () => void;
  subscribe(ids: string[], listener: () => void): () => void;
  inspect(): unknown;
  getSnapshot(): { facts: Record<string, unknown> };
  read(id: string): unknown;
}

export interface Recorder {
  /** Install this in `createSystem({ plugins })`. */
  plugin: Record<string, unknown> & { name: string };
  /** Entries so far, in order. */
  readonly trace: TraceEntry[];
  /** Append an entry the scenario produced (a step, an outside effect). */
  push(entry: TraceEntry): void;
  /** Record `{ k: "external" }` — for definitions that touch the world. */
  external(data: unknown): void;
  /** Snapshot facts, derivations and inspect() under `label`. */
  checkpoint(label: string): void;
  /** Stop observing (hooks stop when the system is destroyed). */
  detach(): void;
}

export interface RecordOptions {
  recorder: Recorder;
}

interface Internal extends Recorder {
  system?: RecordableSystem;
  unsubscribe: Array<() => void>;
  markers: Map<object, string>;
}

export function createRecorder(): Recorder {
  const trace: TraceEntry[] = [];
  const markers = new Map<object, string>();
  const plugin: Record<string, unknown> & { name: string } = {
    name: "conformance-recorder",
  };
  for (const hook of PLUGIN_HOOKS) {
    plugin[hook] = (...args: unknown[]) => {
      if (SYSTEM_HOOKS.has(hook)) {
        trace.push({ k: "hook", hook, args: [] });

        return;
      }
      trace.push({
        k: "hook",
        hook,
        args: args.map((a) => normalize(a, { markers })),
      });
    };
  }

  const rec: Internal = {
    plugin,
    trace,
    unsubscribe: [],
    markers,
    push(entry) {
      trace.push(entry);
    },
    external(data) {
      trace.push({ k: "external", data: normalize(data, { markers }) });
    },
    checkpoint(label) {
      const system = rec.system;
      if (!system) {
        throw new Error("checkpoint() before record(system)");
      }
      const guard = (fn: () => unknown): Json => {
        try {
          return normalize(fn(), { markers });
        } catch (error) {
          return { $throws: normalize(error) };
        }
      };
      const inspect = guard(() => system.inspect());
      const derived: Record<string, Json> = {};
      for (const id of derivationIds(system)) {
        derived[id] = guard(() => system.read(id));
      }
      trace.push({
        k: "state",
        label,
        facts: guard(() => system.getSnapshot().facts),
        derived,
        inspect,
      });
    },
    detach() {
      for (const off of rec.unsubscribe.splice(0)) {
        off();
      }
    },
  };

  return rec;
}

function derivationIds(system: RecordableSystem): string[] {
  try {
    const inspection = system.inspect() as {
      derivations?: Array<{ id: string }>;
    };

    return (inspection.derivations ?? []).map((d) => d.id).sort();
  } catch {
    return [];
  }
}

/** Every declared fact key (from the schema: values exist only after start). */
function factKeys(system: RecordableSystem): string[] {
  try {
    const inspection = system.inspect() as { facts?: Array<{ key: string }> };

    return (inspection.facts ?? []).map((f) => f.key).sort();
  } catch {
    return [];
  }
}

/**
 * Start recording `system`'s observe stream and store notifications into
 * `opts.recorder` (whose plugin the system was created with).
 */
export function record(
  system: RecordableSystem,
  opts: RecordOptions,
): Recorder {
  const rec = opts.recorder as Internal;
  rec.system = system;
  rec.markers.set(system as object, "$system");
  rec.unsubscribe.push(
    system.observe((event) => {
      rec.trace.push({
        k: "observe",
        event: normalize(event, { markers: rec.markers }),
      });
    }),
  );
  // One subscription per id, in a fixed order, so a notification names
  // what changed.
  for (const id of [...factKeys(system), ...derivationIds(system)]) {
    try {
      rec.unsubscribe.push(
        system.subscribe([id], () => {
          rec.trace.push({ k: "notify", id });
        }),
      );
    } catch (error) {
      rec.trace.push({
        k: "threw",
        where: `subscribe ${id}`,
        error: normalize(error),
      });
    }
  }

  return rec;
}
