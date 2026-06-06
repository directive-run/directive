/**
 * Sources Manager — lifecycle owner for typed external event sources.
 *
 * Sources attach at {@link System.start} and tear down at {@link System.stop}.
 * The manager supports the full start → stop → start → stop re-entry cycle:
 * each `attachAll` re-arms the manager, each `cleanupAll` is idempotent until
 * the next `attachAll`. Failures inside attach or unsubscribe are isolated so
 * a single misbehaving source cannot prevent other sources (or the system
 * itself) from completing their lifecycle.
 *
 * The manager also supports {@link SourcesManager.registerDefinitions} for
 * dynamic module registration via {@link System.registerModule}: sources
 * declared on a module registered AFTER the system has started attach
 * immediately; sources declared before the next `start` queue up and attach
 * with the rest.
 *
 * See {@link SourceDef} for the primitive's full semantics + rationale.
 */

import type {
  SourceDef,
  SourcePublish,
  SourceUnsubscribe,
} from "./types/sources.js";

// ============================================================================
// Sources Manager
// ============================================================================

/**
 * Internal record kept per attached source. Used for ordered teardown and
 * idempotency. `moduleId` carries the owning module so error messages can
 * disambiguate (with N modules each declaring a source named "ticker", the
 * operator needs to know which one threw).
 */
interface AttachedSource {
  readonly id: string;
  readonly moduleId: string;
  readonly unsubscribe: SourceUnsubscribe;
  detached: boolean;
}

/**
 * Internal record for a declared (but not yet attached) source. Held in the
 * definitions map so `registerDefinitions` can grow the catalogue between
 * lifecycle cycles. The `moduleId` is captured at registration so attach
 * errors can name the owning module.
 */
interface SourceDefinition {
  readonly def: SourceDef;
  readonly moduleId: string;
}

type LifecyclePhase = "idle" | "attached" | "stopped";

export interface SourcesManager {
  /**
   * Register additional source definitions. Called by `engine.registerModule`
   * when a module is added after `createSystem`. If the system is already in
   * the `attached` phase (i.e. `system.start()` has run), the new sources
   * attach immediately using the cached publisher; otherwise they queue for
   * the next `attachAll`.
   *
   * `moduleId` carries through into error messages so attach failures are
   * unambiguous across modules.
   */
  registerDefinitions(
    moduleId: string,
    definitions: Record<string, SourceDef>,
  ): void;
  /**
   * Attach every registered source against the supplied publisher. Runs once
   * at `system.start()`. On a re-start (`stop → start` cycle), this re-arms
   * the manager: the previous cycle's `attached` array is dropped and every
   * source attaches afresh. If `attach` throws, the failure is logged and
   * the remaining sources still attempt to attach — partial-failure
   * semantics mirror effects + resolvers.
   */
  attachAll(publish: SourcePublish): void;
  /**
   * Invoke every recorded unsubscribe, in reverse-registration order. Runs at
   * `system.stop()`. Idempotent within a single attach cycle — calling twice
   * in the same cycle is a no-op on the second call. The flag clears at the
   * next `attachAll` so a fresh start cleanly attaches + cleans up again.
   * Failures inside an unsubscribe are caught + logged so other sources still
   * tear down.
   */
  cleanupAll(): void;
  /** Number of sources currently attached. Used by `system.inspect()` + tests. */
  attachedCount(): number;
  /**
   * List the declared source definitions for `system.inspect()`. Returns
   * `{ id, moduleId, meta }` rows in registration order. Mirrors how
   * effects are surfaced in `system.inspect()`.
   */
  listDefinitions(): Array<{
    id: string;
    moduleId: string;
    meta?: unknown;
  }>;
}

/**
 * Create a sources manager bound to a (mutable) catalogue of source
 * definitions. The catalogue grows when modules are registered dynamically;
 * the static modules at `createSystem` time seed it via the engine.
 *
 * Errors are surfaced through both `console.error` (always) and the optional
 * `onError` callback (for plugins / error-boundary integration).
 */
export function createSourcesManager(
  initialDefinitions: Record<string, SourceDef> = {},
  initialModuleIds: Record<string, string> = {},
  onError?: (
    id: string,
    moduleId: string,
    phase: "attach" | "cleanup",
    error: Error,
  ) => void,
): SourcesManager {
  const definitions = new Map<string, SourceDefinition>();
  for (const [id, def] of Object.entries(initialDefinitions)) {
    definitions.set(id, { def, moduleId: initialModuleIds[id] ?? "<unknown>" });
  }
  let attached: AttachedSource[] = [];
  let phase: LifecyclePhase = "idle";
  let livePublish: SourcePublish | null = null;
  let attachedDefinitionIds: Set<string> = new Set();

  function attachOne(
    id: string,
    record: SourceDefinition,
    publish: SourcePublish,
  ): void {
    try {
      const unsubscribe = record.def.attach(publish);
      if (typeof unsubscribe !== "function") {
        const err = new Error(
          `[Directive] Module "${record.moduleId}" → Source "${id}" did not return an unsubscribe function from attach(). ` +
            "Every source must return a cleanup function (e.g. `return () => undefined`) so the system can tear it down at stop(). " +
            "If the source needs no teardown, return `() => undefined`, not `undefined`.",
        );
        console.error(err);
        onError?.(id, record.moduleId, "attach", err);
        return;
      }
      attached.push({
        id,
        moduleId: record.moduleId,
        unsubscribe,
        detached: false,
      });
      attachedDefinitionIds.add(id);
    } catch (rawError) {
      const error =
        rawError instanceof Error ? rawError : new Error(String(rawError));
      console.error(
        `[Directive] Module "${record.moduleId}" → Source "${id}" attach() threw:`,
        error,
      );
      onError?.(id, record.moduleId, "attach", error);
    }
  }

  return {
    registerDefinitions(
      moduleId: string,
      newDefinitions: Record<string, SourceDef>,
    ): void {
      for (const [id, def] of Object.entries(newDefinitions)) {
        definitions.set(id, { def, moduleId });
        // If the system is already running (attached phase), attach the new
        // source immediately using the live publisher. Otherwise it queues
        // for the next `attachAll`.
        if (
          phase === "attached" &&
          livePublish &&
          !attachedDefinitionIds.has(id)
        ) {
          attachOne(id, { def, moduleId }, livePublish);
        }
      }
    },

    attachAll(publish: SourcePublish): void {
      // Re-entry support: drop any residual records from a prior cycle. The
      // cleanup contract is that `cleanupAll` ran first; if a consumer
      // bypassed it the records are stale and we forget them here.
      attached = [];
      attachedDefinitionIds = new Set();
      livePublish = publish;
      phase = "attached";
      for (const [id, record] of definitions) {
        attachOne(id, record, publish);
      }
    },

    cleanupAll(): void {
      // Idempotent within a phase: once we've cleaned up in this cycle, the
      // next `attachAll` re-arms us. A second `cleanupAll` in the same phase
      // is a no-op (no double-unsubscribe).
      if (phase !== "attached") return;
      phase = "stopped";
      // Reverse-order teardown so resources release in LIFO order — matches
      // the convention for `useEffect` cleanup, RAII, and most subscription
      // libraries.
      for (let i = attached.length - 1; i >= 0; i--) {
        const record = attached[i];
        if (!record || record.detached) continue;
        record.detached = true;
        try {
          record.unsubscribe();
        } catch (rawError) {
          const error =
            rawError instanceof Error ? rawError : new Error(String(rawError));
          console.error(
            `[Directive] Module "${record.moduleId}" → Source "${record.id}" unsubscribe threw:`,
            error,
          );
          onError?.(record.id, record.moduleId, "cleanup", error);
        }
      }
      // Drop references so the GC can reclaim closures held by long-running
      // subscriptions. We rebuild on the next attachAll.
      attached = [];
      attachedDefinitionIds = new Set();
      livePublish = null;
    },

    attachedCount(): number {
      return attached.filter((r) => !r.detached).length;
    },

    listDefinitions(): Array<{
      id: string;
      moduleId: string;
      meta?: unknown;
    }> {
      const out: Array<{ id: string; moduleId: string; meta?: unknown }> = [];
      for (const [id, record] of definitions) {
        out.push({ id, moduleId: record.moduleId, meta: record.def.meta });
      }
      return out;
    },
  };
}
