/**
 * Sources Manager — lifecycle owner for typed external event sources.
 *
 * Sources are attached once at {@link System.start} and torn down in
 * reverse-registration order at {@link System.stop}. The manager isolates
 * attach/detach exceptions so a single misbehaving source cannot prevent
 * other sources (or the system itself) from completing their lifecycle.
 *
 * See {@link SourceDef} for the primitive's full semantics + rationale.
 */

import type { SourceDef, SourcePublish, SourceUnsubscribe } from "./types/sources.js";

// ============================================================================
// Sources Manager
// ============================================================================

/**
 * Internal record kept per attached source. Used for ordered teardown and
 * idempotency: even if a caller manages to invoke `cleanupAll` twice
 * (e.g. `stop()` → `destroy()` chain), each unsubscribe runs at most once.
 */
interface AttachedSource {
  readonly id: string;
  readonly unsubscribe: SourceUnsubscribe;
  detached: boolean;
}

export interface SourcesManager {
  /**
   * Attach every registered source against the supplied publisher. Runs once
   * at `system.start()`. If `attach` throws, the failure is logged and the
   * remaining sources still attempt to attach — partial-failure semantics
   * mirror effects + resolvers.
   */
  attachAll(publish: SourcePublish): void;
  /**
   * Invoke every recorded unsubscribe, in reverse-registration order. Runs at
   * `system.stop()`. Idempotent — calling twice is a no-op on the second
   * call. Failures inside an unsubscribe are caught + logged so other
   * sources still tear down.
   */
  cleanupAll(): void;
  /** Number of sources currently attached. Used by tests + introspection. */
  attachedCount(): number;
}

/**
 * Create a sources manager bound to the supplied source definitions.
 *
 * The manager is intentionally minimal — sources have no fact dependency
 * tracking, no retry, no batching, and no per-iteration reconciliation. They
 * are mount-once, unmount-once lifecycle hooks. The complex machinery in
 * `createEffectsManager` is wholly inappropriate here; a flat list + try/catch
 * is the correct shape.
 *
 * @param definitions - map of source name → {@link SourceDef}.
 * @param onError - optional callback invoked when `attach` or `unsubscribe`
 *   throws. Receives the source id, the phase ('attach' | 'cleanup'), and the
 *   error. Errors are always logged via `console.error` regardless of
 *   whether this callback is supplied.
 */
export function createSourcesManager(
  definitions: Record<string, SourceDef>,
  onError?: (id: string, phase: "attach" | "cleanup", error: Error) => void,
): SourcesManager {
  const attached: AttachedSource[] = [];
  let cleanedUp = false;

  return {
    attachAll(publish: SourcePublish): void {
      for (const [id, def] of Object.entries(definitions)) {
        try {
          const unsubscribe = def.attach(publish);
          if (typeof unsubscribe !== "function") {
            // Authoring mistake: attach must always return a function so the
            // system has a teardown path. Log + skip; the source remains
            // un-tracked and its cleanup is the author's responsibility.
            const err = new Error(
              `[Directive] Source "${id}" did not return an unsubscribe function from attach(). ` +
                "Every source must return a cleanup function (or `() => undefined`) so the system can tear it down at stop().",
            );
            console.error(err);
            onError?.(id, "attach", err);
            continue;
          }
          attached.push({ id, unsubscribe, detached: false });
        } catch (rawError) {
          const error = rawError instanceof Error ? rawError : new Error(String(rawError));
          console.error(`[Directive] Source "${id}" attach() threw:`, error);
          onError?.(id, "attach", error);
        }
      }
    },

    cleanupAll(): void {
      if (cleanedUp) return;
      cleanedUp = true;
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
          const error = rawError instanceof Error ? rawError : new Error(String(rawError));
          console.error(`[Directive] Source "${record.id}" unsubscribe threw:`, error);
          onError?.(record.id, "cleanup", error);
        }
      }
    },

    attachedCount(): number {
      return attached.filter((r) => !r.detached).length;
    },
  };
}
