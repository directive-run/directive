/**
 * `system.observe()`, as a system part. An observer is a plugin on the
 * plugin manager (as in 1.35: same order, same error logging, same onInit
 * tick) that takes the kernel's records directly and maps each to the 1.35
 * observation events.
 */

import type { KernelEvent } from "../kernel.js";
import type { SystemPart } from "./core.js";
import type { StreamPlugin } from "./plugins.js";
import type { FactChange, ObservationEvent } from "./types.js";

/** The 1.35 observation events for one kernel record (often none). */
export function toObservations(event: KernelEvent): ObservationEvent[] {
  const { at: type } = event;
  switch (type) {
    case "system.start":
    case "system.stop":
    case "system.destroy":
    case "reconcile.start":
      return [{ type }];
    case "reconcile.end":
      return [{ type, resolversCompleted: 0, resolversCanceled: 0 }];
    case "fact.set":
      return [
        {
          type: "fact.change",
          key: event.key,
          prev: event.prev,
          next: event.value,
          origin: "authored",
        },
      ];
    case "fact.batch": {
      // Consecutive writes to a key with the same origin coalesce.
      const out: ObservationEvent[] = [];
      const open = new Map<string, ObservationEvent>();
      for (const change of event.changes as FactChange[]) {
        const next = change.type === "delete" ? undefined : change.value;
        const entry = open.get(change.key);
        if (entry && entry.origin === change.origin) {
          entry.next = next;
          continue;
        }
        const fresh = {
          type: "fact.change",
          key: change.key,
          prev: change.prev,
          next,
          origin: change.origin,
        };
        out.push(fresh);
        open.set(change.key, fresh);
      }

      return out;
    }
    case "derivation.compute":
      return [{ type, id: event.id, value: event.value }];
    case "effect.run":
      return [{ type, id: event.id }];
    case "effect.error":
      return [{ type, id: event.id, error: event.error }];
    case "effect.write-blocked":
      return [{ type, id: event.id, key: event.key }];
    default:
      return [];
  }
}

/** The observe part. Needs the plugins part. */
export const withObserve: SystemPart = ({ kernel, system }) => {
  let observers = 0;
  system.observe = (observer: (event: ObservationEvent) => void) => {
    const plugins = kernel.feature("plugins");
    const name = `__observer_${++observers}`;
    const plugin: StreamPlugin = {
      name,
      onInit: () => observer({ type: "system.init" }),
      event_(event) {
        for (const observation of toObservations(event)) {
          observer(observation);
        }
      },
    };
    plugins.register(plugin);

    return () => plugins.unregister(name);
  };
};
