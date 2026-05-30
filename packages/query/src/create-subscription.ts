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
          const currentKey = keyFn(facts);
          if (currentKey === null) {
            // Key gone (e.g. trigger fact cleared). The previous run's
            // cleanup will fire before the next run by Directive's effect
            // contract, so the AbortController is torn down already; here
            // we just clear the prev-key bookkeeping so a future re-key
            // to the same value still establishes a fresh subscription.
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

          // Key hasn't changed and subscription already active — skip
          if (serializedKey === prevKey) {
            return;
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

          const cleanup = subscribe(currentKey, callbacks);

          return () => {
            controller.abort();
            cleanup?.();
          };
        },
        // Re-run when key facts change (auto-tracked via proxy)
      },
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
