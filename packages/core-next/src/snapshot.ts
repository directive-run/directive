/**
 * Snapshots: an opt-in registry of parts that dump and load (L0b).
 *
 * {@link withSnapshot} adds the `snapshot` feature to a kernel. A kernel's
 * rng, when it has one, is contributed as the `rng` part.
 *
 * @module
 */

import type { Kernel } from "./kernel.js";

/** A part of a snapshot, contributed by a layer or feature. */
export interface SnapshotPart<T = unknown> {
  dump(): T;
  load(data: T): void;
}

export interface Snapshot {
  /** Register a part under a unique id. */
  contribute<T>(id: string, part: SnapshotPart<T>): void;
  /** Every part's data, by id, in contribution order. */
  dump(): Record<string, unknown>;
  /** Load the parts present in `data`. */
  load(data: Record<string, unknown>): void;
}

/** Add (or get) the `snapshot` feature of `kernel`. */
export function withSnapshot(kernel: Kernel): Snapshot {
  if (kernel.has("snapshot")) {
    return kernel.feature("snapshot");
  }
  const parts = new Map<string, SnapshotPart<any>>();
  const snapshot: Snapshot = {
    contribute(key, part) {
      if (parts.has(key)) {
        throw Error(`[Directive] Snapshot part "${key}" already exists`);
      }
      parts.set(key, part);
    },
    dump() {
      const out: Record<string, unknown> = {};
      for (const [key, part] of parts) {
        out[key] = part.dump();
      }

      return out;
    },
    load(data) {
      for (const [key, part] of parts) {
        if (key in data) {
          part.load(data[key]);
        }
      }
    },
  };
  if (kernel.rng) {
    snapshot.contribute("rng", kernel.rng);
  }
  kernel.define("snapshot", snapshot);

  return snapshot;
}
