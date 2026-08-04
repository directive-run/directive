/**
 * createSubscription — Generate effect fragments for push-based data (WebSocket, SSE, AI streaming).
 *
 * Unlike createQuery (pull, Promise<T>), createSubscription handles push-based
 * protocols that deliver multiple values over time. Same ResourceState<T>
 * derivation, same cache, same tags — just different data ingestion.
 *
 * @module
 */

import { withoutTracking } from "@directive-run/core/internals";
import { PREFIX, buildKey, serializeKey } from "./internal.js";

import type { ResourceState } from "./types.js";
import { createIdleResourceState } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/** Callbacks provided to the subscribe function. */
export interface SubscriptionCallbacks<T> {
  /** Push a new data value. Replaces the current cached data. */
  onData: (data: T | ((current: T | null) => T)) => void;
  /** Report an error. Sets ResourceState to error status. */
  onError: (error: Error) => void;
  /**
   * Signal that the subscription has finished delivering values (e.g.
   * SSE stream closed cleanly, server sent its terminal frame). Leaves
   * the most recent `data` in place, keeps `status: "success"`, and
   * sets `isComplete: true` so consumers can distinguish a streaming
   * chunk (`isSuccess && !isComplete`) from the final value
   * (`isComplete`). After this call, further `onData` / `onError`
   * invocations are accepted normally — call it at most once when the
   * underlying transport reaches its terminal frame.
   */
  onComplete?: () => void;
  /** AbortSignal for cancellation (fires when key changes or system stops). */
  signal: AbortSignal;
}

/**
 * Configuration for a push-based subscription.
 *
 * @typeParam TData - The data type delivered by the subscription
 * @typeParam TKey - The key/params type derived from facts
 */
export interface SubscriptionOptions<
  TData,
  TKey extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Unique subscription name. Becomes the derivation key. */
  name: string;

  /** Derive key/params from facts. Return null to unsubscribe. */
  key: (facts: Record<string, unknown>) => TKey | null;

  /**
   * Set up the subscription. Called when key becomes non-null.
   * Return a cleanup function (called when key changes or system stops).
   */
  subscribe: (
    params: TKey,
    callbacks: SubscriptionCallbacks<TData>,
  ) => (() => void) | undefined;

  /** Additional condition for when the subscription should be active. */
  enabled?: (facts: Record<string, unknown>) => boolean;

  /** Tags for cache invalidation. */
  tags?: string[];
}

/** Return type of createSubscription. */
export interface SubscriptionDefinition<TData> {
  readonly name: string;
  readonly schema: {
    readonly facts: Record<string, unknown>;
    readonly derivations: Record<string, unknown>;
  };
  readonly requirements: Record<string, Record<string, unknown>>;
  readonly init: (facts: Record<string, unknown>) => void;
  readonly derive: Record<string, (facts: Record<string, unknown>) => unknown>;
  readonly constraints: Record<string, unknown>;
  readonly resolvers: Record<string, unknown>;
  readonly effects: Record<string, unknown>;
  /**
   * Close the stream belonging to the stopping system. Wired by `withQueries`
   * to the module's `onStop`, which Directive calls after every effect cleanup
   * has fired, and handed that system's facts so the teardown can tell its own
   * stream from one belonging to another system built from this same
   * definition.
   *
   * A stream cannot be closed from an effect cleanup: that fires before every
   * re-run of the effect too, and the two are indistinguishable from inside it.
   */
  readonly onStop: (facts: Record<string, unknown>) => void;
  setData: (facts: Record<string, unknown>, data: TData) => void;
}

// ============================================================================
// createSubscription
// ============================================================================

/**
 * Create a push-based subscription (WebSocket, SSE, AI streaming).
 *
 * @example
 * ```typescript
 * const livePrice = createSubscription({
 *   name: "price",
 *   key: (facts) => facts.ticker ? { ticker: facts.ticker } : null,
 *   subscribe: (params, { onData, onError, signal }) => {
 *     const ws = new WebSocket(`wss://api.example.com/price/${params.ticker}`);
 *     ws.onmessage = (e) => onData(JSON.parse(e.data));
 *     ws.onerror = () => onError(new Error("WebSocket error"));
 *     signal.addEventListener("abort", () => ws.close());
 *     return () => ws.close();
 *   },
 * });
 * ```
 */
export function createSubscription<
  TData,
  TKey extends Record<string, unknown> = Record<string, unknown>,
>(options: SubscriptionOptions<TData, TKey>): SubscriptionDefinition<TData> {
  const { name, key: keyFn, subscribe, enabled, tags: _tags } = options;

  const stateKey = buildKey(name, "state");
  const keyKey = buildKey(name, "key");

  // The previous serialized key is tracked in a WeakMap keyed by the live
  // facts object instead of inside the facts store. Reading + writing the
  // same fact inside an auto-tracked effect makes the effect depend on
  // itself: writing `facts[keyKey]` would re-trigger the effect, fire its
  // cleanup, and abort the live AbortController on the first emission. A
  // closure WeakMap removes that read-write self-trigger while still
  // letting each system keep its own prev-key bookkeeping.
  const prevKeyByFacts = new WeakMap<object, string>();

  /**
   * The system a facts object belongs to, as an identity we can recover from
   * both sides of a teardown.
   *
   * The effect body only ever sees facts, and in a namespaced system that is a
   * module-scoped view rather than the store-wide proxy `onStop` is handed —
   * two different objects over one system. What they share is the facts store
   * underneath, which Directive exposes as `$store` on either view and creates
   * exactly once per system. So the store is the thing that says "this system"
   * no matter which door you came in through. A facts object with no store
   * behind it stands for itself, which is the single-module case where the two
   * views are the same object anyway.
   */
  function systemOf(facts: Record<string, unknown>): object {
    return (facts.$store as object | undefined) ?? facts;
  }

  /**
   * The stream currently established, per system.
   *
   * Directive fires an effect's cleanup **before** re-running it as well as
   * when the system is torn down, and the two are indistinguishable from
   * inside the cleanup. Aborting there killed the stream on every re-run — and
   * an auto-tracked effect whose `key()` reads no facts records no
   * dependencies, which Directive reads as "unknown" and re-runs on every
   * reconcile. So a subscription with a constant key died the first time
   * anything else in the system moved, silently: the controller was aborted,
   * the body's same-key early return declined to re-establish anything, and
   * every callback became a no-op with the resource state frozen on whatever
   * had already arrived.
   *
   * So the cleanup *marks* rather than tears down, and the two things that
   * genuinely end a stream do it themselves: a re-key, which the body handles
   * because it is building the replacement, and system stop, which arrives on
   * `onStop` after every cleanup has fired. A re-run marks and then clears the
   * mark, and the stream never notices.
   *
   * Keyed per system, because this closure is per *definition*. A subscription
   * definition is an ordinary value: nothing stops two systems being built from
   * it, and request-scoped systems, isolated tests, and multi-tenant workers all
   * do exactly that. A registry that held every system's stream together would
   * hand teardown a list it cannot tell apart, and stopping one system would
   * close streams belonging to systems still running — silently, since closing a
   * stream leaves its resource state reporting the last value it received.
   */
  const liveBySystem = new WeakMap<
    object,
    {
      controller: AbortController;
      unsubscribe: (() => void) | undefined;
      teardown: () => void;
      /** Set by the cleanup, cleared by the body when it is only a re-run. */
      marked: boolean;
    }
  >();

  /** Close a stream for good. */
  function close(record: {
    controller: AbortController;
    unsubscribe: (() => void) | undefined;
  }): void {
    record.controller.abort();
    record.unsubscribe?.();
  }

  /** Build ResourceState derivation. */
  function buildState(facts: Record<string, unknown>): ResourceState<TData> {
    const state = facts[stateKey] as ResourceState<TData> | undefined;
    if (!state) {
      return createIdleResourceState<TData>();
    }

    return state;
  }

  return {
    name,

    schema: {
      facts: {
        [stateKey]: { _type: null as unknown },
        [keyKey]: { _type: "" as unknown },
      },
      derivations: {
        [name]: { _type: null as unknown },
      },
    },

    requirements: {},

    init: (facts: Record<string, unknown>) => {
      facts[stateKey] = createIdleResourceState<TData>();
      facts[keyKey] = null;
    },

    derive: {
      [name]: buildState,
    },

    // Subscriptions don't use constraints/resolvers — they use effects
    constraints: {},
    resolvers: {},

    effects: {
      [`${PREFIX}${name}_sub`]: {
        run: (facts: Record<string, unknown>) => {
          const system = systemOf(facts);
          const currentKey = keyFn(facts);
          if (currentKey === null) {
            // Key gone (e.g. trigger fact cleared). The previous run's
            // cleanup will fire before the next run by Directive's effect
            // contract, so the AbortController is torn down already; here
            // we just clear the prev-key bookkeeping so a future re-key
            // to the same value still establishes a fresh subscription.
            const gone = liveBySystem.get(system);
            if (gone !== undefined) {
              liveBySystem.delete(system);
              close(gone);
            }
            if (prevKeyByFacts.delete(facts)) {
              facts[keyKey] = null;
              // Reset the resource state to idle so consumers re-render
              // with no stale `isSuccess`/`isComplete` carry-over.
              facts[stateKey] = createIdleResourceState<TData>();
            }
            return;
          }

          if (enabled && !enabled(facts)) {
            return;
          }

          const serializedKey = serializeKey(currentKey);

          // Track prev key off-fact so we don't depend on our own writes.
          const prevKey = prevKeyByFacts.get(facts) ?? null;

          const live = liveBySystem.get(system);

          // Key hasn't changed and the stream is still established — this is a
          // re-run, not a re-key. Clear the mark the cleanup left and hand the
          // same teardown back, so Directive goes on holding it.
          if (serializedKey === prevKey && live !== undefined) {
            live.marked = false;

            return live.teardown;
          }

          // Re-keyed. The stream being replaced goes now, because its
          // successor is built below and the two must not overlap.
          if (live !== undefined) {
            liveBySystem.delete(system);
            close(live);
          }

          // Update key tracking (in closure + in facts for downstream
          // observers; the facts write isn't read by the effect so it
          // doesn't cause a self-trigger).
          prevKeyByFacts.set(facts, serializedKey);
          facts[keyKey] = serializedKey;

          // Set pending state. Re-keying resets `isComplete` because the
          // previous stream's terminal signal no longer applies to the new
          // subscription instance. Reading prev state is untracked so a
          // re-emission of the stream (which writes `stateKey`) does not
          // cause this effect to re-run.
          const prevState = withoutTracking(
            () => facts[stateKey] as ResourceState<TData>,
          );
          facts[stateKey] = {
            ...prevState,
            status: "pending",
            isPending: prevState.data === null,
            isFetching: true,
            isComplete: false,
          };

          // Create abort controller for this subscription instance
          const controller = new AbortController();

          const callbacks: SubscriptionCallbacks<TData> = {
            onData: (dataOrUpdater) => {
              if (controller.signal.aborted) {
                return;
              }

              const currentState = facts[stateKey] as ResourceState<TData>;
              const newData =
                typeof dataOrUpdater === "function"
                  ? (dataOrUpdater as (current: TData | null) => TData)(
                      currentState.data,
                    )
                  : dataOrUpdater;

              facts[stateKey] = {
                ...currentState,
                data: newData,
                status: "success",
                isPending: false,
                isFetching: false,
                isSuccess: true,
                isError: false,
                isStale: false,
                error: null,
                dataUpdatedAt: Date.now(),
              };
            },
            onError: (error) => {
              if (controller.signal.aborted) {
                return;
              }

              const currentState = facts[stateKey] as ResourceState<TData>;
              facts[stateKey] = {
                ...currentState,
                status: "error",
                isPending: false,
                isFetching: false,
                isError: true,
                isSuccess: false,
                error,
                failureCount: currentState.failureCount + 1,
                failureReason: error,
              };
            },
            onComplete: () => {
              if (controller.signal.aborted) {
                return;
              }

              const currentState = facts[stateKey] as ResourceState<TData>;
              facts[stateKey] = {
                ...currentState,
                isPending: false,
                isFetching: false,
                isComplete: true,
              };
            },
            signal: controller.signal,
          };

          const unsubscribe = subscribe(currentKey, callbacks) ?? undefined;
          const record = {
            controller,
            unsubscribe,
            teardown: () => {},
            marked: false,
          };
          // Marks, and nothing more. See `liveByFacts` for why a cleanup is
          // the wrong place to end a stream.
          record.teardown = () => {
            record.marked = true;
          };
          liveBySystem.set(system, record);

          return record.teardown;
        },
        // Re-run when key facts change (auto-tracked via proxy)
      },
    },

    /**
     * The one signal that means teardown.
     *
     * Fired by `withQueries` from the module's `onStop`, which Directive calls
     * after every effect cleanup — so by this point a cleanup that was really
     * a re-run has already been cleared by the body that followed it, and what
     * is left is a stream nobody is going to re-establish.
     *
     * The facts belong to the system that is stopping, and only its stream is
     * closed. Any other system built from this same definition is still running
     * and still expecting its data.
     */
    onStop: (facts: Record<string, unknown>) => {
      const system = systemOf(facts);
      const live = liveBySystem.get(system);
      if (live !== undefined) {
        liveBySystem.delete(system);
        close(live);
      }
    },

    setData: (facts: Record<string, unknown>, data: TData) => {
      const prevState =
        (facts[stateKey] as ResourceState<TData>) ??
        createIdleResourceState<TData>();
      facts[stateKey] = {
        ...prevState,
        data,
        status: "success",
        isPending: false,
        isFetching: false,
        isSuccess: true,
        isError: false,
        error: null,
        dataUpdatedAt: Date.now(),
      };
    },
  };
}
