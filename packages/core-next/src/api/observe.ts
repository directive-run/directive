/**
 * `system.observe()`, as a system part. An observer is a plugin on the
 * plugin manager (as in 1.35: same order, same error logging, same onInit
 * tick) that takes the kernel's records directly and maps each to the 1.35
 * observation events.
 */

import type { KernelEvent } from "../kernel.js";
import type { SystemPart } from "./core.js";
import type { StreamPlugin } from "./plugins.js";
import { localId } from "./sources.js";
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
    case "reconcile.end": {
      const r = event.result as { completed?: unknown; canceled?: unknown };
      const count = (list: unknown) => (Array.isArray(list) ? list.length : 0);

      return [
        {
          type,
          resolversCompleted: count(r?.completed),
          resolversCanceled: count(r?.canceled),
        },
      ];
    }
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
    // L2 (reconcile.ts), shaped as 1.35's observer shapes them.
    case "constraint.evaluate":
      return [{ type, id: event.id, active: event.active }];
    case "constraint.error":
      return [{ type, id: event.id, error: event.error }];
    case "constraint.binding.disabled":
      return [{ type, id: event.id, reason: event.reason }];
    case "resolver.write.rejected": {
      // As 1.35: the hook's event, with the requirement by id.
      const { req, ...rest } = event.event as { req: { id: string } };

      return [{ type, ...rest, requirementId: req.id }];
    }
    case "requirement.created": {
      const req = event.req as { id: string; requirement: { type: string } };

      return [{ type, id: req.id, requirementType: req.requirement.type }];
    }
    case "requirement.met":
      return [
        {
          type,
          id: (event.req as { id: string }).id,
          byResolver: event.resolver,
        },
      ];
    case "requirement.canceled":
      return [{ type, id: (event.req as { id: string }).id }];
    case "resolver.start":
      return [
        {
          type,
          resolver: event.resolver,
          requirementId: (event.req as { id: string }).id,
        },
      ];
    case "resolver.complete":
      return [
        {
          type,
          resolver: event.resolver,
          requirementId: (event.req as { id: string }).id,
          duration: event.duration,
        },
      ];
    case "resolver.error":
      return [
        {
          type,
          resolver: event.resolver,
          requirementId: (event.req as { id: string }).id,
          error: event.error,
        },
      ];
    case "effect.error":
      return [{ type, id: event.id, error: event.error }];
    case "effect.write-blocked":
      return [{ type, id: event.id, key: event.key }];
    // L3: system.notify (plugins.ts), shaped as 1.35's observer shapes them.
    case "guardrail.blocked": {
      const { plugin, key, kind, count, category } = event;

      return [
        {
          type,
          plugin,
          key,
          kind,
          count,
          ...(category !== undefined ? { category } : {}),
        },
      ];
    }
    case "guardrail.coverage": {
      const { plugin, screenedCount, screenedDigest, reason } = event;

      return [{ type, plugin, screenedCount, screenedDigest, reason }];
    }
    // L5: sources.ts, with 1.35's localId; the rest in the order emitted.
    case "source.attach":
    case "source.publish":
    case "source.drop":
    case "source.detach":
    case "source.error": {
      const { at, t, seq, sys, id, moduleId, ...rest } = event as Record<
        string,
        any
      >;

      return [{ type, id, moduleId, localId: localId(id, moduleId), ...rest }];
    }
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
        const batch = event.at === "fact.batch";
        for (const observation of toObservations(event)) {
          if (!batch) {
            observer(observation);
            continue;
          }
          // As in 1.35: one throw does not stop the rest of the batch.
          try {
            observer(observation);
          } catch (error) {
            console.error(
              `[Directive] Observer threw on fact "${(observation as { key?: string }).key}"; the remaining keys in this batch were still delivered.`,
              error,
            );
          }
        }
      },
    };
    plugins.register(plugin);

    return () => plugins.unregister(name);
  };
};
