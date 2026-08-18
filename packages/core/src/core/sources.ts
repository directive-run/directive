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
  SourceDropReason,
  SourcePublish,
  SourceUnsubscribe,
} from "./types/sources.js";

// ============================================================================
// Sources Manager
// ============================================================================

interface AttachedSource {
  readonly id: string;
  readonly moduleId: string;
  // Mutated once during `attachOne` — pre-built record with a placeholder
  // unsubscribe so the per-source publish closure can close over the record
  // identity (for the `detached` re-registration race guard). The real
  // unsubscribe is installed immediately after `attach()` returns
  // successfully. Not `readonly` because the late-bind is honest about the
  // mutation rather than smuggling it through `Object.assign`.
  unsubscribe: SourceUnsubscribe;
  detached: boolean;
  /**
   * Why this record was detached. Set by `detachOne` / `cleanupAll` at the
   * moment `detached` flips. Only `"gate-closed"` drives publish accounting
   * (an in-flight publish after a gate close counts as a drop); `"stop"` and
   * `"re-register"` keep the historic silent-return behaviour.
   */
  detachReason?: "gate-closed" | "re-register" | "stop";
  /** RFC 0012: resolved gate key this record was attached under (keyed sources). */
  key?: string;
}

interface SourceDefinition {
  readonly def: SourceDef;
  readonly moduleId: string;
}

/** Maximum characters preserved from a source error message before truncation. */
const SOURCE_ERROR_MESSAGE_MAX = 256;

/**
 * Hard-cap any error message we record to a fixed length so a source whose
 * `attach()` throws with a payload-embedded message
 * (`throw new Error(\`bad row: ${JSON.stringify(piiRow)}\`)`) doesn't write
 * unbounded PII into `inspect().sources[i].lastError.message` AND the audit
 * ledger. Source authors who need the full message in development can opt
 * into a logging plugin that captures the raw `Error` object.
 */
function truncateSourceErrorMessage(message: string): string {
  if (message.length <= SOURCE_ERROR_MESSAGE_MAX) return message;
  return `${message.slice(0, SOURCE_ERROR_MESSAGE_MAX)}…[${message.length - SOURCE_ERROR_MESSAGE_MAX} chars truncated]`;
}

/**
 * Per-source counters surfaced via `system.inspect().sources[i]`. Operators
 * read these to answer "is this source publishing?" "when did it last fire?"
 * "is it errored?" without having to wire a custom plugin first.
 *
 * `dropCount` + `lastDropReason` count publishes the engine's dispatch guard
 * rejected (post-stop, BLOCKED_PROPS event name, empty / non-string event
 * name). Without these, attackers could probe the BLOCKED_PROPS list or the
 * isRunning guard invisibly — telemetry would never advance and no plugin
 * hook would fire.
 *
 * All counters reset at the next `attachAll` (i.e. each `system.start()` cycle
 * starts fresh) so a stop → start sequence does not leak counts across cycles.
 */
interface SourceCounters {
  publishCount: number;
  lastPublishAt: number | null;
  dropCount: number;
  lastDropReason: SourceDropReason | null;
  lastDropAt: number | null;
  errorCount: number;
  lastError: {
    phase: "attach" | "cleanup" | "runtime" | "gate";
    message: string;
    at: number;
  } | null;
  attachedAt: number | null;
  detachedAt: number | null;
}

/**
 * Default per-source lifecycle timeout. Caps any single `unsubscribe()`
 * or `onEvict()` so a hung transport (Supabase channel that never acks,
 * Cloudflare DO storage flush wedged on a saturated D1, audit-log sink
 * paused) cannot stall the rest of teardown / eviction. Five seconds is
 * comfortable for healthy transports and short enough for ops to
 * recognize a hang.
 */
export const DEFAULT_PER_SOURCE_TIMEOUT_MS = 5_000;

/**
 * Resolve the per-source teardown timeout for a single source. Accepts
 * the source's `evictTimeoutMs` override (which can be `Infinity` to
 * disable) and falls back to the package-wide default.
 */
function resolveSourceTimeout(override: number | undefined): number {
  if (override === undefined) return DEFAULT_PER_SOURCE_TIMEOUT_MS;
  if (override === Number.POSITIVE_INFINITY) return override;
  if (!Number.isFinite(override) || override <= 0) {
    return DEFAULT_PER_SOURCE_TIMEOUT_MS;
  }
  return Math.floor(override);
}

/**
 * Race a Promise against a wall-clock timeout. On timeout, fires
 * `onTimeout` with a structured error and resolves; the source's
 * underlying work continues in the background but the caller is
 * unblocked. The Promise's eventual rejection (after the timeout
 * fired) is swallowed so it doesn't surface as `unhandledRejection`
 * in the host.
 */
async function raceWithTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T | undefined> {
  // `Infinity` disables the cap — skip the timer wiring entirely so
  // Node's setTimeout doesn't emit a TimeoutOverflowWarning (its
  // delay argument is a 32-bit int that can't represent Infinity).
  if (timeoutMs === Number.POSITIVE_INFINITY) {
    return await work;
  }
  let timeoutFired = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      timeoutFired = true;
      onTimeout();
      resolve(undefined);
    }, timeoutMs);
  });
  // Catch the work's rejection AFTER the timeout fired so we don't
  // emit unhandledRejection. The first resolution wins via Promise.race.
  const safeWork = work.catch((err) => {
    if (timeoutFired) {
      // The timeout already fired; swallow the late rejection.
      return undefined as T;
    }
    throw err;
  });
  try {
    return await Promise.race([safeWork, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function emptyCounters(): SourceCounters {
  return {
    publishCount: 0,
    lastPublishAt: null,
    dropCount: 0,
    lastDropReason: null,
    lastDropAt: null,
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
 *
 * Returns a {@link SourceDispatchResult} indicating whether the engine
 * accepted the publish. The manager uses the result to gate counter bumps
 * + `onPublish` plugin emission: an accepted publish bumps `publishCount`
 * and fires `onPublish`; a rejected publish bumps `dropCount` /
 * `lastDropReason` and stays out of the plugin hook (otherwise observers
 * would see "publish happened" for events the engine swallowed).
 */
export type SourceDispatch = (
  sourceId: string,
  moduleId: string,
  eventName: string,
  payload: unknown,
) => SourceDispatchResult;

/**
 * Outcome of a single source publish handed back to the manager. `"accepted"`
 * means the engine dispatched into the event handler chain. Rejection
 * reasons name the specific drop path so per-source telemetry can attribute
 * the drop precisely:
 *
 * - `"post-destroy"` — publish arrived after `system.destroy()`.
 * - `"post-stop"` — publish arrived between `system.stop()` and the next
 *   `system.start()`.
 * - `"blocked-event-name"` — event name was `__proto__` / `constructor` /
 *   `prototype` (BLOCKED_PROPS guard, parity with `system.dispatch`).
 * - `"invalid-event-name"` — event name was non-string or empty string.
 */
export type SourceDispatchResult =
  | { accepted: true }
  | { accepted: false; reason: SourceDropReason };

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
  /**
   * Fires when the engine OR the manager rejects a publish. Mirrors
   * `onPublish` so plugin observers can pair every accepted publish
   * with the drop side without polling `inspect().sources[i].dropCount`.
   *
   * `reason` matches the value the manager writes to `lastDropReason`
   * on the inspect row. Use this hook to drive alerting (a source whose
   * `lastDropReason: "blocked-event-name"` is a misconfiguration; a
   * source whose `lastDropReason: "coalesced"` is publishing too fast).
   */
  readonly onDrop?: (
    id: string,
    moduleId: string,
    eventName: string,
    reason: SourceDropReason,
  ) => void;
  readonly onDetach?: (id: string, moduleId: string) => void;
  readonly onError?: (
    id: string,
    moduleId: string,
    phase: "attach" | "cleanup" | "runtime" | "gate",
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
   *
   * Sync variant kept for back-compat: async unsubscribes are kicked off
   * (the Promise is captured but not awaited). Use {@link cleanupAllAsync}
   * when you need to await the actual transport teardown (e.g. Supabase
   * `channel.unsubscribe()` returns a Promise that must complete before
   * the broker drops the subscription).
   */
  cleanupAll(): void;
  /**
   * RFC 0009: async-aware cleanup. Awaits each source's unsubscribe in
   * reverse-registration order. Errors are caught + reported as
   * `phase: "cleanup"` so a single failing unsubscribe cannot block the
   * rest of the teardown.
   *
   * The host runtime calls this from `System.stopAsync()` /
   * `System.destroyAsync()`. For sync `system.stop()` callers, the sync
   * `cleanupAll` is still used (Promises from async unsubscribes are
   * fire-and-forget).
   */
  cleanupAllAsync(): Promise<void>;
  /**
   * RFC 0009: signal eviction to every source whose definition declares
   * `onEvict`. Runs in registration order so sources with downstream
   * dependencies close in the right order. Errors are caught + reported
   * as `phase: "runtime"`. After `evictAll`, the host runtime calls
   * `cleanupAllAsync`.
   */
  evictAll(): Promise<void>;
  /**
   * RFC 0012 — re-evaluate every GATED source's `key` / `active` gate
   * against the supplied committed-fact snapshot and reconcile its
   * subscription lifecycle:
   *
   * - `null → key` (rising edge): attach under the new key.
   * - `key → null` (falling) / `keyA → keyB` (re-key): tear the old
   *   subscription down BEFORE attaching the new one; honours
   *   `gateLingerMs` hysteresis on the falling / re-key edge.
   * - unchanged key: no-op.
   *
   * A gate that throws or returns a non-`(string | null)` fails CLOSED
   * (treated as `null`, reported via `onError` with `phase: "gate"`).
   *
   * Called once at `system.start()` (initial gated attach) and thereafter
   * on the post-commit effects plane after each reconcile. Teardown here is
   * SYNC fire-and-forget so it never blocks reconcile. Ungated sources are
   * untouched — they attach via `attachAll` as before.
   */
  evaluateGated(facts: Record<string, unknown>): void;
  /** Number of sources currently attached. Used by `system.inspect()`. */
  attachedCount(): number;
  /**
   * List the declared source definitions for `system.inspect()`. Returns
   * `{ id, moduleId, meta, attached, publishCount, lastPublishAt,
   * dropCount, lastDropReason, lastDropAt, errorCount, lastError,
   * attachedAt, detachedAt }` rows in registration order. Mirrors how
   * effects are surfaced, with per-source telemetry an operator can read
   * without registering a custom plugin.
   */
  listDefinitions(): SourceInspectionRow[];
}

/**
 * Public per-source telemetry row returned by
 * `SourcesManager.listDefinitions()` and surfaced unchanged on
 * `SystemInspection.sources[i]`. Exported so consumers can name the type
 * when writing helpers over the inspect output.
 */
export interface SourceInspectionRow {
  id: string;
  moduleId: string;
  meta?: unknown;
  attached: boolean;
  publishCount: number;
  lastPublishAt: number | null;
  /**
   * Publishes the engine's dispatch guard rejected OR the manager
   * coalesced this cycle. Operators monitor this to spot misconfigured
   * sources (wrong event names) and to verify the coalesce strategy is
   * actually debouncing the high-frequency sources it was meant to.
   */
  dropCount: number;
  /**
   * Reason for the most recent rejected publish, or `null`.
   * - `"post-destroy"` / `"post-stop"` — leaked transport
   * - `"blocked-event-name"` / `"invalid-event-name"` — guard probe
   * - `"coalesced"` — manager debounced a same-event-name publish
   *   ahead of the microtask flush (only when `SourceDef.coalesce`
   *   is `"lastWriteWins"`)
   */
  lastDropReason: SourceDropReason | null;
  /** Wall-clock ms of the most recent rejected publish, or `null`. */
  lastDropAt: number | null;
  errorCount: number;
  lastError: SourceLastError | null;
  attachedAt: number | null;
  detachedAt: number | null;
}

/**
 * The most recent attach or cleanup error a source has recorded this cycle.
 * `message` is truncated to a fixed length so a source that throws with a
 * payload-embedded message does not write unbounded data into inspect
 * output (and downstream into the audit ledger).
 */
export interface SourceLastError {
  phase: "attach" | "cleanup" | "runtime" | "gate";
  message: string;
  at: number;
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
  // RFC 0012 gated-source state.
  //   keyFns:       normalized gate function per gated source id (`active`
  //                 sugar is folded into a `key` fn at registration).
  //   lastKey:      the key each gated source is CURRENTLY attached under
  //                 (or null if detached). This is the committed key — during
  //                 a linger window it stays put until the timer fires.
  //   lingerTimers: pending falling / re-key teardown timers keyed by source
  //                 id, each carrying the key it is transitioning toward.
  const keyFns = new Map<string, (facts: Record<string, unknown>) => unknown>();
  const lastKey = new Map<string, string | null>();
  const lingerTimers = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; target: string | null }
  >();

  /**
   * Normalize a source definition's gate at registration. Throws a dev
   * error if both `key` and `active` are declared; folds `active` sugar into
   * a `key` fn; records the gate fn in `keyFns` for gated sources (leaves
   * ungated sources absent from the map).
   */
  function registerGate(id: string, def: SourceDef): void {
    const hasKey = typeof def.key === "function";
    const hasActive = typeof def.active === "function";
    if (hasKey && hasActive) {
      throw new Error(
        `[Directive] Source "${id}" declares both \`key\` and \`active\`. Use ONE: \`key\` for identity-based re-keying (returns a string | null), \`active\` for a simple on/off gate (returns a boolean).`,
      );
    }
    if (hasActive) {
      const activeFn = def.active as (f: Record<string, unknown>) => boolean;
      // Strict `=== true` (not truthy): a gate must fail CLOSED. A non-boolean
      // truthy return (a stray object/number) must NOT open a data channel —
      // it's treated as detached, same posture as a throwing gate (G4).
      keyFns.set(id, (facts) => (activeFn(facts) === true ? "__on__" : null));
    } else if (hasKey) {
      keyFns.set(id, def.key as (f: Record<string, unknown>) => unknown);
    } else {
      keyFns.delete(id);
    }
  }

  for (const [id, def] of Object.entries(initialDefinitions)) {
    definitions.set(id, { def, moduleId: initialModuleIds[id] ?? "<unknown>" });
    registerGate(id, def);
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
    pErr: "attach" | "cleanup" | "runtime" | "gate",
    error: Error,
  ): void {
    const c = counters.get(id) ?? emptyCounters();
    c.errorCount += 1;
    c.lastError = {
      phase: pErr,
      message: truncateSourceErrorMessage(error.message),
      at: Date.now(),
    };
    counters.set(id, c);
  }

  function reportError(
    id: string,
    moduleId: string,
    pErr: "attach" | "cleanup" | "runtime" | "gate",
    error: Error,
  ): void {
    bumpError(id, pErr, error);
    // Hand plugins (audit-ledger, logging, devtools) an `Error` whose
    // `message` is already truncated at the manager boundary. The
    // privacy invariant is "one bounded message ceiling across all
    // three sinks" — `inspect().sources[i].lastError.message`, the
    // audit-ledger `source.error` entry, and the logging plugin's
    // `error`-level emission. Without this, a source whose `attach()`
    // throws with a payload-embedded message would have leaked the
    // payload into the immutable hash-chained ledger AND the operator's
    // structured log backend even after the inspect path was closed.
    //
    // The original `Error` (with full message + stack) is still
    // `console.error`'d for dev visibility upstream of this call —
    // that's a developer tool, not a privacy sink.
    const safeError =
      error.message.length <= SOURCE_ERROR_MESSAGE_MAX
        ? error
        : Object.assign(new Error(truncateSourceErrorMessage(error.message)), {
            name: error.name,
            stack: error.stack,
          });
    callbacks.onError?.(id, moduleId, pErr, safeError);
  }

  function attachOne(
    id: string,
    record: SourceDefinition,
    dispatch: SourceDispatch,
    resolvedKey?: string,
  ): void {
    // Pre-build the AttachedSource record so the per-source publish closure
    // can close over `attachedRecord.detached` instead of a captured-once
    // boolean. Without this, an OLD source's external transport that fires
    // an in-flight callback AFTER re-registration would still
    // dispatch through the OLD closure with stale attribution. The closure
    // checks `attachedRecord.detached` on every publish; re-registration
    // flips that flag synchronously before the new source attaches.
    const attachedRecord: AttachedSource = {
      id,
      moduleId: record.moduleId,
      unsubscribe: () => undefined,
      detached: false,
      key: resolvedKey,
    };

    // RFC 0012: an in-flight publish that arrives AFTER this record was
    // detached because its gate CLOSED is counted as a `gate-closed` drop
    // (the historic detached-guard silently returned). Post-stop /
    // re-register detaches keep the silent return.
    const accountGateClosedDrop = (eventName: string): void => {
      if (attachedRecord.detachReason !== "gate-closed") return;
      const c = counters.get(id);
      if (c) {
        c.dropCount += 1;
        c.lastDropReason = "gate-closed";
        c.lastDropAt = Date.now();
      }
      callbacks.onDrop?.(id, record.moduleId, eventName, "gate-closed");
    };

    // Seed the counters entry BEFORE invoking `record.def.attach()` so a
    // source whose `attach` synchronously publishes (the seed-initial-state
    // pattern) gets its counter bumped + onPublish fired even though
    // attach hasn't returned yet. The matching `attachedAt` / `detachedAt`
    // updates happen post-attach so they reflect the actual lifecycle
    // transitions, not the seeding step.
    if (!counters.has(id)) counters.set(id, emptyCounters());

    // Inner publish — runs after the optional coalesce queue drains.
    // Closure-wrap per-source so the engine receives accurate
    // `(sourceId, moduleId)` attribution on every publish. The `detached`
    // flag closes the re-registration race window: an OLD source's
    // in-flight callback fired after unsubscribe will hit the guard and
    // no-op. Counter bump + `onPublish` plugin emission fire ONLY when
    // the engine accepts the publish — split prevents attackers probing
    // BLOCKED_PROPS / `isRunning` invisibly.
    const innerPublish: SourcePublish = (eventName, payload) => {
      if (attachedRecord.detached) {
        accountGateClosedDrop(eventName);
        return;
      }
      const result = dispatch(id, record.moduleId, eventName, payload);
      const c = counters.get(id);
      if (!c) return; // unreachable; defensive no-op
      const now = Date.now();
      if (result.accepted) {
        c.publishCount += 1;
        c.lastPublishAt = now;
        callbacks.onPublish?.(id, record.moduleId, eventName);
      } else {
        c.dropCount += 1;
        c.lastDropReason = result.reason;
        c.lastDropAt = now;
        callbacks.onDrop?.(id, record.moduleId, eventName, result.reason);
      }
    };

    // Optional coalesce wrap: when the source declares
    // `coalesce: "lastWriteWins"`, the manager queues at most ONE
    // publish per event name per microtask. Subsequent publishes with
    // the same event name within the same microtask cycle overwrite the
    // pending payload and bump `dropCount` / `lastDropReason: "coalesced"`.
    // The microtask flush drains every pending entry through
    // `innerPublish`. Per-event-name keying means a `priceTick` storm
    // can debounce while a one-shot `connected` event still dispatches.
    let perSourcePublish: SourcePublish;
    if (record.def.coalesce === "lastWriteWins") {
      const pending = new Map<string, unknown>();
      let flushScheduled = false;
      perSourcePublish = (eventName, payload) => {
        if (attachedRecord.detached) {
          accountGateClosedDrop(eventName);
          return;
        }
        // The manager's coalesce drop fires BEFORE the engine guard so a
        // detected drop is attributed to coalescing, not to the engine
        // rejecting an event name. Operators who see `lastDropReason:
        // "coalesced"` know to look at the source's publish rate, not
        // their event-name spelling.
        if (pending.has(eventName)) {
          const c = counters.get(id);
          if (c) {
            c.dropCount += 1;
            c.lastDropReason = "coalesced";
            c.lastDropAt = Date.now();
          }
          callbacks.onDrop?.(id, record.moduleId, eventName, "coalesced");
        }
        pending.set(eventName, payload);
        if (!flushScheduled) {
          flushScheduled = true;
          queueMicrotask(() => {
            flushScheduled = false;
            if (attachedRecord.detached) {
              pending.clear();
              return;
            }
            // Snapshot + clear so a publish INSIDE innerPublish's
            // downstream handler can re-enter the queue cleanly.
            const drained = Array.from(pending);
            pending.clear();
            for (const [eventName, payload] of drained) {
              innerPublish(eventName, payload);
            }
          });
        }
      };
    } else {
      // "none" (default) and "all" share the unbuffered path.
      perSourcePublish = innerPublish;
    }

    try {
      // RFC 0008: hand the source a `reportError` callback so authors
      // can route runtime errors (WebSocket disconnect, stale Supabase
      // channel, fetch failure) through `phase: "runtime"` instead of
      // inventing magic event names like `STREAM_ERROR`. Runtime errors
      // share the same sinks as attach/cleanup failures
      // (audit-ledger source.error, logging plugin onSourceError,
      // inspect().sources[i].lastError) so observers correlate the
      // failure with the source lifecycle automatically.
      const reportRuntimeError: import("./types/sources.js").SourceReportError =
        (runtimeError) => {
          if (attachedRecord.detached) return;
          const safeRuntimeError =
            runtimeError instanceof Error
              ? runtimeError
              : new Error(String(runtimeError));
          reportError(id, record.moduleId, "runtime", safeRuntimeError);
        };
      // RFC 0012: keyed sources receive the resolved key as a 3rd arg so
      // the subscription can be built from it. Ungated sources get the
      // historic 2-arg call — `ctx` is undefined and never constructed.
      const unsubscribe =
        resolvedKey === undefined
          ? record.def.attach(perSourcePublish, reportRuntimeError)
          : record.def.attach(perSourcePublish, reportRuntimeError, {
              key: resolvedKey,
            });
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
            ? `[Directive] Module "${record.moduleId}" → Source "${id}" attach() returned a Promise. attach() must be synchronous; rewrite as \`attach: (publish) => { ... return () => unsubscribe(); }\`. Do any async work inside the subscription's own internals — the cleanup function must be registered immediately so \`system.stop()\` can tear the source down.`
            : `[Directive] Module "${record.moduleId}" → Source "${id}" did not return an unsubscribe function from attach(). Every source must return a cleanup function (e.g. \`return () => undefined\`) so the system can tear it down at stop(). If the source needs no teardown, return \`() => undefined\`, not \`undefined\`.`,
        );
        console.error(err);
        reportError(id, record.moduleId, "attach", err);
        return;
      }
      // Late-bind the real unsubscribe + push the live record.
      attachedRecord.unsubscribe = unsubscribe;
      attached.push(attachedRecord);
      attachedDefinitionIds.add(id);
      // The counters entry was seeded at the top of attachOne (so publish-
      // during-attach is counted). Record the actual attach timestamp now.
      const c = counters.get(id);
      if (c) {
        c.attachedAt = Date.now();
        c.detachedAt = null;
      }
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

  /**
   * Tear a single attached source down and remove it from the live set.
   * Extracted from the inline re-registration teardown so the gate path
   * (RFC 0012) and the re-registration path share one code path.
   *
   * `detached` flips BEFORE `unsubscribe()` runs so the source's still-
   * referenced publish closure no-ops (and, for `"gate-closed"`, accounts
   * the drop). `onDetach` fires before teardown side effects; unsubscribe
   * failures report `phase: "cleanup"`.
   */
  function detachOne(
    record: AttachedSource,
    reason: "gate-closed" | "re-register" | "stop",
  ): void {
    record.detached = true;
    record.detachReason = reason;
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
        `[Directive] Module "${record.moduleId}" → Source "${record.id}" unsubscribe threw during ${reason}:`,
        error,
      );
      reportError(record.id, record.moduleId, "cleanup", error);
    }
    const idx = attached.indexOf(record);
    if (idx !== -1) attached.splice(idx, 1);
    attachedDefinitionIds.delete(record.id);
  }

  /** Find the live (non-detached) attached record for a source id, if any. */
  function findAttached(id: string): AttachedSource | undefined {
    return attached.find((r) => r && !r.detached && r.id === id);
  }

  /**
   * RFC 0012: reconcile ONE gated source from its committed key to a newly
   * computed key `k`. Handles rising / falling / re-key edges + linger
   * hysteresis. `committed` is the key the source is currently attached
   * under (from `lastKey`). Never called when `committed === k`.
   */
  function transitionGated(
    id: string,
    def: SourceDefinition,
    dispatch: SourceDispatch,
    committed: string | null,
    k: string | null,
  ): void {
    if (committed === null) {
      // Rising edge — attach immediately (linger never applies to a rise).
      attachOne(id, def, dispatch, k ?? undefined);
      lastKey.set(id, k);
      return;
    }
    // Falling (k === null) or re-key (k !== null): linger may apply.
    const lingerMs = def.def.gateLingerMs ?? 0;
    const runTeardownAndReattach = (): void => {
      const rec = findAttached(id);
      if (rec) detachOne(rec, "gate-closed");
      if (k !== null) attachOne(id, def, dispatch, k);
      lastKey.set(id, k);
    };
    if (lingerMs > 0) {
      const timer = setTimeout(() => {
        lingerTimers.delete(id);
        runTeardownAndReattach();
      }, lingerMs);
      lingerTimers.set(id, { timer, target: k });
      // `committed`/`lastKey` stay put until the timer fires so a return to
      // the prior key inside the window can cancel cleanly.
      return;
    }
    runTeardownAndReattach();
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
          // `detachOne` flips `detached` BEFORE unsubscribe (closing the
          // in-flight re-registration race — a publish already holding the
          // old closure no-ops), fires `onDetach`, and removes the record.
          const old = findAttached(id);
          if (old) {
            detachOne(old, "re-register");
          } else {
            attachedDefinitionIds.delete(id);
          }
        }
        // Reset any pending gate state for a re-registered id so the new
        // definition re-evaluates from a clean slate.
        const pendingLinger = lingerTimers.get(id);
        if (pendingLinger) {
          clearTimeout(pendingLinger.timer);
          lingerTimers.delete(id);
        }
        lastKey.delete(id);

        definitions.set(id, { def, moduleId });
        registerGate(id, def);
        // If the system is already running, attach the new source
        // immediately using the live dispatcher. `onAttach` fires from
        // inside `attachOne` so the engine emits the plugin event with
        // correct attribution — closes the registerModule observability
        // gap AND the re-registration leak.
        //
        // GATED sources are the exception: they do NOT attach here (we have
        // no fact snapshot in `registerDefinitions`). They attach on the
        // next `evaluateGated(facts)` call — the engine runs one on the
        // post-commit effects plane, and `registerModule` triggers a
        // reconcile — so a gated source registered while running attaches
        // on the very next pass.
        if (
          phase === "attached" &&
          liveDispatch &&
          !attachedDefinitionIds.has(id) &&
          !keyFns.has(id)
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
      // RFC 0012: clear gate state so a stop → start cycle re-evaluates every
      // gate fresh. Pending linger timers from the previous cycle are
      // abandoned (their target sources are gone with the old `attached`).
      for (const { timer } of lingerTimers.values()) clearTimeout(timer);
      lingerTimers.clear();
      lastKey.clear();
      liveDispatch = dispatch;
      phase = "attached";
      for (const [id, record] of definitions) {
        // Ungated sources attach exactly as before. GATED sources are left to
        // the initial `evaluateGated(facts)` call (the engine runs one at
        // `start()` right after `attachAll`, then on every effects plane).
        if (keyFns.has(id)) continue;
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
          // Sync caller. Promise return values are discarded (the
          // unsubscribe runs to completion in the background); use
          // `cleanupAllAsync` when you need to await the teardown.
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
      // RFC 0012: clear gate state + any pending linger timers so teardown
      // leaves nothing scheduled to fire against a stopped system.
      for (const { timer } of lingerTimers.values()) clearTimeout(timer);
      lingerTimers.clear();
      lastKey.clear();
    },

    async cleanupAllAsync(): Promise<void> {
      if (phase !== "attached") return;
      phase = "stopped";
      // Reverse-order teardown so resources release in LIFO order.
      // Each unsubscribe is wrapped in a per-source timeout
      // (`SourceDef.evictTimeoutMs` if supplied, else
      // `DEFAULT_PER_SOURCE_TIMEOUT_MS` = 5_000ms) so one hanging
      // transport — Supabase channel.unsubscribe() stuck on a
      // broker that never acks, Cloudflare DO storage flush that
      // wedges — cannot block the rest of teardown indefinitely.
      // The hang surfaces as a `reportError` and teardown continues.
      for (let i = attached.length - 1; i >= 0; i--) {
        const record = attached[i];
        if (!record || record.detached) continue;
        record.detached = true;
        callbacks.onDetach?.(record.id, record.moduleId);
        const c = counters.get(record.id) ?? emptyCounters();
        c.detachedAt = Date.now();
        counters.set(record.id, c);
        const def = definitions.get(record.id)?.def;
        const timeoutMs = resolveSourceTimeout(def?.evictTimeoutMs);
        try {
          await raceWithTimeout(
            Promise.resolve(record.unsubscribe()),
            timeoutMs,
            () => {
              const err = new Error(
                `[Directive] Module "${record.moduleId}" → Source "${record.id}" unsubscribe exceeded ${timeoutMs}ms timeout; abandoning to unblock teardown.`,
              );
              console.error(err.message);
              reportError(record.id, record.moduleId, "cleanup", err);
            },
          );
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
      // RFC 0012: clear gate state + any pending linger timers so teardown
      // leaves nothing scheduled to fire against a stopped system.
      for (const { timer } of lingerTimers.values()) clearTimeout(timer);
      lingerTimers.clear();
      lastKey.clear();
    },

    async evictAll(): Promise<void> {
      if (phase !== "attached") return;
      // Eviction runs in registration order so sources with downstream
      // dependencies close in the right order (the dual of unsubscribe's
      // reverse-registration order — same rationale as start vs. stop).
      // Each onEvict is wrapped in a per-source timeout
      // (`SourceDef.evictTimeoutMs` if supplied) so a slow `onEvict`
      // (e.g., audit-log flush hanging on a saturated sink) doesn't
      // consume the engine's evict deadline at the expense of
      // downstream sources. Failures isolate via try/catch + timeout.
      for (const record of attached) {
        if (record.detached) continue;
        const def = definitions.get(record.id)?.def;
        if (!def?.onEvict) continue;
        const timeoutMs = resolveSourceTimeout(def.evictTimeoutMs);
        try {
          await raceWithTimeout(
            Promise.resolve(def.onEvict()),
            timeoutMs,
            () => {
              const err = new Error(
                `[Directive] Module "${record.moduleId}" → Source "${record.id}" onEvict exceeded ${timeoutMs}ms timeout; abandoning so downstream sources still get evicted.`,
              );
              console.error(err.message);
              reportError(record.id, record.moduleId, "runtime", err);
            },
          );
        } catch (rawError) {
          const error =
            rawError instanceof Error ? rawError : new Error(String(rawError));
          console.error(
            `[Directive] Module "${record.moduleId}" → Source "${record.id}" onEvict threw:`,
            error,
          );
          reportError(record.id, record.moduleId, "runtime", error);
        }
      }
    },

    evaluateGated(facts: Record<string, unknown>): void {
      if (phase !== "attached" || !liveDispatch) return;
      const dispatch = liveDispatch;
      for (const [id, keyFn] of keyFns) {
        const def = definitions.get(id);
        if (!def) continue;

        // Compute the key FAIL-CLOSED: a gate that throws or returns a
        // non-(string | null) is treated as `null` (detach) and reported
        // via `phase: "gate"`.
        let k: string | null;
        try {
          const raw = keyFn(facts);
          if (raw === null) {
            k = null;
          } else if (typeof raw === "string") {
            k = raw;
          } else {
            throw new Error(
              `gate returned ${raw === undefined ? "undefined" : typeof raw} — must return string | null`,
            );
          }
        } catch (rawError) {
          k = null;
          const error =
            rawError instanceof Error ? rawError : new Error(String(rawError));
          reportError(id, def.moduleId, "gate", error);
        }

        const committed = lastKey.get(id) ?? null;
        const pending = lingerTimers.get(id);

        if (pending) {
          // A linger is in flight: committed → pending.target.
          if (k === committed) {
            // Returned to the prior key inside the window — cancel teardown.
            clearTimeout(pending.timer);
            lingerTimers.delete(id);
          } else if (k === pending.target) {
            // Still heading to the same target — leave the timer running.
          } else {
            // Target moved to a THIRD distinct key mid-linger. The prior state
            // is gone, so tear the committed channel down NOW (bounding its
            // open time to this one window) instead of re-arming another linger
            // from the same unchanged `committed` key — a key flapping to new
            // values faster than lingerMs could otherwise re-defer that
            // teardown indefinitely, leaving the original subscription open
            // (the post-close exposure the gate exists to prevent). Linger
            // absorbs a RETURN to the same prior key, not a walk to new ones.
            clearTimeout(pending.timer);
            lingerTimers.delete(id);
            const rec = findAttached(id);
            if (rec) detachOne(rec, "gate-closed");
            if (k !== null) attachOne(id, def, dispatch, k);
            lastKey.set(id, k);
          }
          continue;
        }

        if (k === committed) continue; // no-op
        transitionGated(id, def, dispatch, committed, k);
      }
    },

    attachedCount(): number {
      return attached.filter((r) => !r.detached).length;
    },

    listDefinitions(): SourceInspectionRow[] {
      const out: SourceInspectionRow[] = [];
      for (const [id, record] of definitions) {
        const c = counters.get(id) ?? emptyCounters();
        out.push({
          id,
          moduleId: record.moduleId,
          meta: record.def.meta,
          attached: attachedDefinitionIds.has(id),
          publishCount: c.publishCount,
          lastPublishAt: c.lastPublishAt,
          dropCount: c.dropCount,
          lastDropReason: c.lastDropReason,
          lastDropAt: c.lastDropAt,
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
