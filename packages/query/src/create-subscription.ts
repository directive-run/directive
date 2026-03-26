/**
 * createSubscription — Generate effect fragments for push-based data (WebSocket, SSE, AI streaming).
 *
 * Unlike createQuery (pull, Promise<T>), createSubscription handles push-based
 * protocols that deliver multiple values over time. Same ResourceState<T>
 * derivation, same cache, same tags — just different data ingestion.
 *
 * @module
 */

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
            return;
          }

          if (enabled && !enabled(facts)) {
            return;
          }

          const serializedKey = serializeKey(currentKey);
          const prevKey = facts[keyKey] as string | null;

          // Key hasn't changed and subscription already active — skip
          if (serializedKey === prevKey) {
            return;
          }

          // Update key tracking
          facts[keyKey] = serializedKey;

          // Set pending state
          const prevState = facts[stateKey] as ResourceState<TData>;
          facts[stateKey] = {
            ...prevState,
            status: "pending",
            isPending: prevState.data === null,
            isFetching: true,
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
