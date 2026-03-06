/**
 * Synchronous atomic kill switch — removes ALL AI-created definitions immediately.
 *
 * One call. No async cleanup. No awaiting. No race conditions.
 */

import type { System } from "@directive-run/core";
import type { ArchitectDefType, KillResult } from "./types.js";

/**
 * Synchronously unregister all AI-created definitions from the system.
 *
 * @param system - The Directive system to purge AI definitions from.
 * @param dynamicIds - Set of definition IDs tracked by the architect.
 *                     Each entry is `"type::id"` (e.g., `"constraint::auto-retry"`).
 * @returns Details of what was removed.
 */
export function killAll(
  system: System,
  dynamicIds: Set<string>,
): KillResult {
  const removed: Array<{ type: ArchitectDefType; id: string }> = [];

  for (const entry of dynamicIds) {
    const sepIndex = entry.indexOf("::");
    if (sepIndex === -1) {
      continue;
    }

    const type = entry.slice(0, sepIndex) as ArchitectDefType;
    const id = entry.slice(sepIndex + 2);

    try {
      switch (type) {
        case "constraint":
          system.constraints.unregister(id);
          break;
        case "resolver":
          system.resolvers.unregister(id);
          break;
        case "effect":
          system.effects.unregister(id);
          break;
        case "derivation":
          // Derivations may not be available on all systems
          if ("derivations" in system && typeof (system as Record<string, unknown>).derivations === "object") {
            const derivations = (system as Record<string, { unregister: (id: string) => void } | undefined>).derivations;
            derivations?.unregister(id);
          }
          break;
      }

      removed.push({ type, id });
    } catch {
      // Best-effort removal — don't let one failure stop others
    }
  }

  dynamicIds.clear();

  return {
    removed: removed.length,
    definitions: removed,
    timestamp: Date.now(),
  };
}
