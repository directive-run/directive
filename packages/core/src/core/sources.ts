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
 * The manager invokes per-source lifecycle callbacks (`onAttach`,
 * `onPublish`, `onDetach`, `onError`) so the engine can emit accurate plugin
 * observation events — including correct per-source attribution even when
 * two sources publish the same event name.
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

interface AttachedSource {
  readonly id: string;
  readonly moduleId: string;
  readonly unsubscribe: SourceUnsubscribe;
  detached: boolean;
}

interface SourceDefinition {
  readonly def: SourceDef;
  readonly moduleId: string;
}

/**
 * Per-source counters surfaced via `system.inspect().sources[i]`. Operators
 * read these to answer "is this source publishing?" "when did it last fire?"
 * "is it errored?" without having to wire a custom plugin first.
 *
 * All counters reset at the next `attachAll` (i.e. each `system.start()` cycle
 * starts fresh) so a stop → start sequence does not leak counts across cycles.
 */
interface SourceCounters {
  publishCount: number;
  lastPublishAt: number | null;
  errorCount: number;
  lastError: {
    phase: "attach" | "cleanup";
    message: string;
    at: number;
  } | null;
  attachedAt: number | null;
  detachedAt: number | null;
}

function emptyCounters(): SourceCounters {
  return {
    publishCount: 0,
    lastPublishAt: null,
    errorCount: 0,
    lastError: null,
    attachedAt: null,
    detachedAt: null,
  };
}

type LifecyclePhase = "idle" | "attached" | "stopped";

/**
 * Engine-side dispatcher invoked when a source publishes an event. The
 * manager wraps each source's publish callback in a closure that closes
 * over the source id + moduleId so the engine cannot mis-attribute
 * publishes (a naive "look up the source by event name" approach fails
 * when multiple sources publish the same event).
 */
export type SourceDispatch = (
  sourceId: string,
  moduleId: string,
  eventName: string,
  payload: unknown,
) => void;

/**
 * Per-source lifecycle callbacks the engine wires into the plugin manager.
 * All are optional — manager-only consumers can omit them. The manager
 * GUARANTEES:
 *
 * - `onAttach(id, moduleId)` runs ONLY when `attach()` returned a function
 *   (i.e. the source successfully attached). Sources that threw or returned
 *   non-functions invoke `onError` instead.
 * - `onPublish(id, moduleId, eventName)` runs BEFORE the engine's dispatch,
 *   per publish call, with correct per-source attribution.
 * - `onDetach(id, moduleId)` runs BEFORE the source's unsubscribe is called
 *   so observers see the detach intent before any teardown side effects.
 *   (If unsubscribe throws, `onError` fires afterward.)
 * - `onError(id, moduleId, phase, error)` runs on attach OR cleanup failures.
 *   Always logged via `console.error` regardless of whether this callback
 *   is supplied.
 */
export interface SourcesManagerCallbacks {
  readonly onAttach?: (id: string, moduleId: string) => void;
  readonly onPublish?: (
    id: string,
    moduleId: string,
    eventName: string,
  ) => void;
  readonly onDetach?: (id: string, moduleId: string) => void;
  readonly onError?: (
    id: string,
    moduleId: string,
    phase: "attach" | "cleanup",
    error: Error,
  ) => void;
}

export interface SourcesManager {
  registerDefinitions(
    moduleId: string,
    definitions: Record<string, SourceDef>,
  ): void;
  /**
   * Attach every registered source against the supplied dispatcher. Runs at
   * `system.start()`. On a re-start, this re-arms the manager: the previous
   * cycle's `attached` array is dropped and every source attaches afresh.
   *
   * The manager wraps each source's publish callback with a closure that
   * forwards to `dispatch(sourceId, moduleId, eventName, payload)`. Sources
   * that successfully attach also trigger the `onAttach` callback; failures
   * trigger `onError`.
   */
  attachAll(dispatch: SourceDispatch): void;
  /**
   * Invoke every recorded unsubscribe, in reverse-registration order. Runs at
   * `system.stop()`. Idempotent within a single attach cycle — calling twice
   * is a no-op on the second call. The flag clears at the next `attachAll`.
   *
   * `onDetach` fires BEFORE each unsubscribe runs. `onError` fires AFTER if
   * the unsubscribe throws.
   */
  cleanupAll(): void;
  /** Number of sources currently attached. Used by `system.inspect()`. */
  attachedCount(): number;
  /**
   * List the declared source definitions for `system.inspect()`. Returns
   * `{ id, moduleId, meta, attached, publishCount, lastPublishAt,
   * errorCount, lastError, attachedAt, detachedAt }` rows in registration
   * order. Mirrors how effects are surfaced, with per-source telemetry an
   * operator can read without registering a custom plugin.
   */
  listDefinitions(): Array<{
    id: string;
    moduleId: string;
    meta?: unknown;
    attached: boolean;
    publishCount: number;
    lastPublishAt: number | null;
    errorCount: number;
    lastError: {
      phase: "attach" | "cleanup";
      message: string;
      at: number;
    } | null;
    attachedAt: number | null;
    detachedAt: number | null;
  }>;
}

/**
 * Create a sources manager bound to a (mutable) catalogue of source
 * definitions. The catalogue grows when modules are registered dynamically;
 * the static modules at `createSystem` time seed it via the engine.
 */
export function createSourcesManager(
  initialDefinitions: Record<string, SourceDef> = {},
  initialModuleIds: Record<string, string> = {},
  callbacks: SourcesManagerCallbacks = {},
): SourcesManager {
  const definitions = new Map<string, SourceDefinition>();
  for (const [id, def] of Object.entries(initialDefinitions)) {
    definitions.set(id, { def, moduleId: initialModuleIds[id] ?? "<unknown>" });
  }
  let attached: AttachedSource[] = [];
  let phase: LifecyclePhase = "idle";
  let liveDispatch: SourceDispatch | null = null;
  let attachedDefinitionIds: Set<string> = new Set();
  // Per-source counters (publishCount, lastPublishAt, errorCount, ...).
  // Reset at every `attachAll` so a stop → start sequence starts fresh.
  const counters = new Map<string, SourceCounters>();

  function bumpError(
    id: string,
    pErr: "attach" | "cleanup",
    error: Error,
  ): void {
    const c = counters.get(id) ?? emptyCounters();
    c.errorCount += 1;
    c.lastError = { phase: pErr, message: error.message, at: Date.now() };
    counters.set(id, c);
  }

  function reportError(
    id: string,
    moduleId: string,
    pErr: "attach" | "cleanup",
    error: Error,
  ): void {
    bumpError(id, pErr, error);
    callbacks.onError?.(id, moduleId, pErr, error);
  }

  function attachOne(
    id: string,
    record: SourceDefinition,
    dispatch: SourceDispatch,
  ): void {
    // Pre-build the AttachedSource record so the per-source publish closure
    // can close over `attachedRecord.detached` instead of a captured-once
    // boolean. Without this, an OLD source's external transport that fires
    // an in-flight callback AFTER re-registration (R3 swap) would still
    // dispatch through the OLD closure with stale attribution. The closure
    // checks `attachedRecord.detached` on every publish; re-registration
    // flips that flag synchronously before the new source attaches.
    const attachedRecord: AttachedSource = {
      id,
      moduleId: record.moduleId,
      unsubscribe: () => undefined,
      detached: false,
    };

    // Closure-wrap the publish callback per-source so the engine receives
    // accurate `(sourceId, moduleId)` attribution on every publish — this is
    // what makes the observation pipeline correct even when N sources
    // publish the same event name. The `detached` flag closes the
    // re-registration race window: an OLD source's in-flight callback fired
    // after unsubscribe will hit the `detached` guard and no-op.
    const perSourcePublish: SourcePublish = (eventName, payload) => {
      if (attachedRecord.detached) return;
      const c = counters.get(id) ?? emptyCounters();
      c.publishCount += 1;
      c.lastPublishAt = Date.now();
      counters.set(id, c);
      callbacks.onPublish?.(id, record.moduleId, eventName);
      dispatch(id, record.moduleId, eventName, payload);
    };

    try {
      const unsubscribe = record.def.attach(perSourcePublish);
      if (typeof unsubscribe !== "function") {
        // Distinguish "returned a thenable" (almost always: author wrote
        // `attach: async (publish) => () => {}`) from "returned non-function"
        // so the diagnostic actually tells the author what to fix.
        const looksLikePromise =
          unsubscribe !== null &&
          typeof unsubscribe === "object" &&
          typeof (unsubscribe as { then?: unknown }).then === "function";
        const err = new Error(
          looksLikePromise
            ? `[Directive] Module "${record.moduleId}" → Source "${id}" attach() returned a Promise. attach() must be synchronous; ` +
              "rewrite as `attach: (publish) => { ... return () => unsubscribe(); }`. Do any async work inside the subscription's own internals — " +
              "the cleanup function must be registered immediately so `system.stop()` can tear the source down."
            : `[Directive] Module "${record.moduleId}" → Source "${id}" did not return an unsubscribe function from attach(). ` +
              "Every source must return a cleanup function (e.g. `return () => undefined`) so the system can tear it down at stop(). " +
              "If the source needs no teardown, return `() => undefined`, not `undefined`.",
        );
        console.error(err);
        reportError(id, record.moduleId, "attach", err);
        return;
      }
      // Late-bind the real unsubscribe + push the live record.
      Object.assign(attachedRecord, { unsubscribe });
      attached.push(attachedRecord);
      attachedDefinitionIds.add(id);
      const c = counters.get(id) ?? emptyCounters();
      c.attachedAt = Date.now();
      c.detachedAt = null;
      counters.set(id, c);
      // Emit AFTER successful attach so observers cannot see attach for a
      // source that failed or returned a non-function unsubscribe.
      callbacks.onAttach?.(id, record.moduleId);
    } catch (rawError) {
      const error =
        rawError instanceof Error ? rawError : new Error(String(rawError));
      console.error(
        `[Directive] Module "${record.moduleId}" → Source "${id}" attach() threw:`,
        error,
      );
      reportError(id, record.moduleId, "attach", error);
    }
  }

  return {
    registerDefinitions(
      moduleId: string,
      newDefinitions: Record<string, SourceDef>,
    ): void {
      for (const [id, def] of Object.entries(newDefinitions)) {
        // Re-registration semantics: if this source id is ALREADY attached
        // (hot-reload scenario, or a module bringing the same source id as
        // another), unsubscribe the old definition first so the new one
        // takes its place cleanly. Without this guard the old subscription
        // would stay running (its `unsubscribe` only runs at cleanupAll)
        // AND the new definition would never attach (the
        // `attachedDefinitionIds.has(id)` check below would block it). The
        // result is a "ghost subscription + dead definition" leak.
        if (phase === "attached" && attachedDefinitionIds.has(id)) {
          for (let i = 0; i < attached.length; i++) {
            const old = attached[i];
            if (!old || old.detached || old.id !== id) continue;
            // Flip the per-record `detached` flag BEFORE running unsubscribe.
            // The old source's `perSourcePublish` closure (still referenced by
            // the external transport) reads this flag on every publish and
            // no-ops once it flips — closes the in-flight re-registration
            // race that R3's registry swap did not cover.
            old.detached = true;
            callbacks.onDetach?.(old.id, old.moduleId);
            const cOld = counters.get(old.id) ?? emptyCounters();
            cOld.detachedAt = Date.now();
            counters.set(old.id, cOld);
            try {
              old.unsubscribe();
            } catch (rawError) {
              const error =
                rawError instanceof Error
                  ? rawError
                  : new Error(String(rawError));
              console.error(
                `[Directive] Module "${old.moduleId}" → Source "${old.id}" unsubscribe threw during re-registration:`,
                error,
              );
              reportError(old.id, old.moduleId, "cleanup", error);
            }
            attached.splice(i, 1);
            break;
          }
          attachedDefinitionIds.delete(id);
        }

        definitions.set(id, { def, moduleId });
        // If the system is already running, attach the new source
        // immediately using the live dispatcher. `onAttach` fires from
        // inside `attachOne` so the engine emits the plugin event with
        // correct attribution — closes the registerModule observability
        // gap (R2-CR3) AND the re-registration leak (R3-M1).
        if (
          phase === "attached" &&
          liveDispatch &&
          !attachedDefinitionIds.has(id)
        ) {
          attachOne(id, { def, moduleId }, liveDispatch);
        }
      }
    },

    attachAll(dispatch: SourceDispatch): void {
      attached = [];
      attachedDefinitionIds = new Set();
      // Reset counters at every fresh start so a stop → start sequence does
      // not carry "ghost" counts from the previous cycle.
      counters.clear();
      liveDispatch = dispatch;
      phase = "attached";
      for (const [id, record] of definitions) {
        attachOne(id, record, dispatch);
      }
    },

    cleanupAll(): void {
      if (phase !== "attached") return;
      phase = "stopped";
      // Reverse-order teardown so resources release in LIFO order.
      for (let i = attached.length - 1; i >= 0; i--) {
        const record = attached[i];
        if (!record || record.detached) continue;
        record.detached = true;
        // Emit detach BEFORE the unsubscribe runs so observers see the
        // intent before any teardown side effects.
        callbacks.onDetach?.(record.id, record.moduleId);
        const c = counters.get(record.id) ?? emptyCounters();
        c.detachedAt = Date.now();
        counters.set(record.id, c);
        try {
          record.unsubscribe();
        } catch (rawError) {
          const error =
            rawError instanceof Error ? rawError : new Error(String(rawError));
          console.error(
            `[Directive] Module "${record.moduleId}" → Source "${record.id}" unsubscribe threw:`,
            error,
          );
          reportError(record.id, record.moduleId, "cleanup", error);
        }
      }
      attached = [];
      attachedDefinitionIds = new Set();
      liveDispatch = null;
    },

    attachedCount(): number {
      return attached.filter((r) => !r.detached).length;
    },

    listDefinitions(): Array<{
      id: string;
      moduleId: string;
      meta?: unknown;
      attached: boolean;
      publishCount: number;
      lastPublishAt: number | null;
      errorCount: number;
      lastError: {
        phase: "attach" | "cleanup";
        message: string;
        at: number;
      } | null;
      attachedAt: number | null;
      detachedAt: number | null;
    }> {
      const out: Array<{
        id: string;
        moduleId: string;
        meta?: unknown;
        attached: boolean;
        publishCount: number;
        lastPublishAt: number | null;
        errorCount: number;
        lastError: {
          phase: "attach" | "cleanup";
          message: string;
          at: number;
        } | null;
        attachedAt: number | null;
        detachedAt: number | null;
      }> = [];
      for (const [id, record] of definitions) {
        const c = counters.get(id) ?? emptyCounters();
        out.push({
          id,
          moduleId: record.moduleId,
          meta: record.def.meta,
          attached: attachedDefinitionIds.has(id),
          publishCount: c.publishCount,
          lastPublishAt: c.lastPublishAt,
          errorCount: c.errorCount,
          lastError: c.lastError,
          attachedAt: c.attachedAt,
          detachedAt: c.detachedAt,
        });
      }
      return out;
    },
  };
}
