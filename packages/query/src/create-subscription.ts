/**
 * createSubscription — Generate source fragments for push-based data (WebSocket, SSE, AI streaming).
 *
 * Unlike createQuery (pull, Promise<T>), createSubscription handles push-based
 * protocols that deliver multiple values over time. Same ResourceState<T>
 * derivation, same cache, same tags — just different data ingestion.
 *
 * @module
 */

import {
  PREFIX,
  type QueryPublish,
  buildEvent,
  buildKey,
  serializeKey,
} from "./internal.js";

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
    readonly events?: Record<string, Record<string, unknown>>;
  };
  readonly requirements: Record<string, Record<string, unknown>>;
  readonly init: (facts: Record<string, unknown>) => void;
  readonly derive: Record<string, (facts: Record<string, unknown>) => unknown>;
  readonly constraints: Record<string, unknown>;
  readonly resolvers: Record<string, unknown>;
  /** Empty: the stream arrives from outside, so it is a source. */
  readonly effects: Record<string, unknown>;
  /**
   * The stream, as a keyed source. Directive opens it when `key()` returns a
   * value, re-opens it when that value changes, closes it when `key()`
   * returns null or the system stops, and never re-opens it on a history
   * rewind. Each system built from this definition has its own.
   */
  readonly sources?: Record<string, unknown>;
  /** Handlers for what the stream publishes: started, data, error, complete. */
  readonly events?: Record<
    string,
    (facts: Record<string, unknown>, event: Record<string, unknown>) => void
  >;
  /**
   * Run when the system stops, handed that system's facts. Unused by
   * `createSubscription`, whose stream is closed by its source; kept for
   * hand-built definitions.
   */
  readonly onStop?: (facts: Record<string, unknown>) => void;
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

  const startedEvent = buildEvent(name, "SUB_STARTED");
  const dataEvent = buildEvent(name, "SUB_DATA");
  const errorEvent = buildEvent(name, "SUB_ERROR");
  const completeEvent = buildEvent(name, "SUB_COMPLETE");
  const resetType = `${PREFIX}${name.toUpperCase()}_SUB_RESET`;

  /**
   * The key object `key()` returned, per system, for the stream about to open.
   *
   * A source's `attach` receives only the gate's string key, but `subscribe`
   * is promised the object `key()` returned, which may hold values JSON does
   * not round-trip. One definition can back many systems, so the gate's key
   * carries a token for its system, and the object is kept under that token:
   * the latest one the gate produced, removed when that stream closes.
   */
  const pending = new Map<number, { serialized: string; params: TKey }>();
  const tokens = new WeakMap<object, number>();
  let nextToken = 0;

  /** A number standing for the system whose gate facts these are. */
  function tokenFor(facts: Record<string, unknown>): number {
    let token = tokens.get(facts);
    if (token === undefined) {
      token = ++nextToken;
      tokens.set(facts, token);
    }

    return token;
  }

  /** The key the stream should be open for, or null for none. */
  function wantedKey(facts: Record<string, unknown>): TKey | null {
    const currentKey = keyFn(facts);
    if (currentKey === null) {
      return null;
    }
    if (enabled && !enabled(facts)) {
      return null;
    }

    return currentKey;
  }

  /** The gate: `<token>|<serialized key>`, or null to close the stream. */
  function gateKey(facts: Record<string, unknown>): string | null {
    const currentKey = wantedKey(facts);
    if (currentKey === null) {
      return null;
    }
    const token = tokenFor(facts);
    const serialized = serializeKey(currentKey);
    pending.set(token, { serialized, params: currentKey });

    return `${token}|${serialized}`;
  }

  /** Close the user's stream: abort first, then their own teardown. */
  function close(
    controller: AbortController,
    unsubscribe: (() => void) | undefined,
  ): void {
    controller.abort();
    // `unsubscribe` is whatever the user's `subscribe` handed back. Abort has
    // already happened, so the stream is closed either way; a throw here is
    // reported rather than allowed to stop the teardown of every other source.
    try {
      unsubscribe?.();
    } catch (error) {
      console.error(
        `[Directive] Subscription "${name}" unsubscribe threw an error:`,
        error,
      );
    }
  }

  /**
   * Open the stream for one key.
   *
   * The source manager owns the lifecycle, per system: it attaches when the
   * gate opens, tears down then re-attaches when the key changes, detaches
   * when the gate closes or the system stops, and never re-attaches on a
   * history rewind. So this only ever opens one stream and returns the one
   * thing that closes it.
   */
  function attach(
    publish: QueryPublish,
    _reportError: unknown,
    ctx?: { readonly key: string },
  ): () => void {
    const gate = ctx!.key;
    const split = gate.indexOf("|");
    const token = Number(gate.slice(0, split));
    const serialized = gate.slice(split + 1);
    const held = pending.get(token);
    const params =
      held?.serialized === serialized
        ? held.params
        : (JSON.parse(serialized) as TKey);

    const controller = new AbortController();
    publish(startedEvent, { key: serialized });

    const callbacks: SubscriptionCallbacks<TData> = {
      onData: (dataOrUpdater) => {
        if (!controller.signal.aborted) {
          publish(dataEvent, { key: serialized, value: dataOrUpdater });
        }
      },
      onError: (error) => {
        if (!controller.signal.aborted) {
          publish(errorEvent, { key: serialized, error });
        }
      },
      onComplete: () => {
        if (!controller.signal.aborted) {
          publish(completeEvent, { key: serialized });
        }
      },
      signal: controller.signal,
    };

    const unsubscribe = subscribe(params, callbacks) ?? undefined;

    return () => {
      // Only this stream's entry: on a re-key the gate has already stored
      // the next key's object, and that one is still to be opened.
      if (pending.get(token)?.serialized === serialized) {
        pending.delete(token);
      }
      close(controller, unsubscribe);
    };
  }

  /**
   * The current state, if the event belongs to the stream that is open now.
   * An event from a stream that has since been replaced is ignored.
   */
  function stateFor(
    facts: Record<string, unknown>,
    event: Record<string, unknown>,
  ): ResourceState<TData> | null {
    if (facts[keyKey] !== event.key) {
      return null;
    }

    return facts[stateKey] as ResourceState<TData>;
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
      events: {
        [startedEvent]: {},
        [dataEvent]: {},
        [errorEvent]: {},
        [completeEvent]: {},
      },
    },

    requirements: {
      [resetType]: {},
    },

    init: (facts: Record<string, unknown>) => {
      facts[stateKey] = createIdleResourceState<TData>();
      facts[keyKey] = null;
    },

    derive: {
      [name]: buildState,
    },

    // When the key goes away or `enabled()` turns false, the source closes
    // the stream and the state goes back to idle here, so consumers stop
    // showing a value (or a fetch in progress) from a stream that no longer
    // exists. A later re-key to the same value then starts fresh.
    constraints: {
      [`${PREFIX}${name}_sub_reset`]: {
        when: (facts: Record<string, unknown>) =>
          facts[keyKey] !== null && wantedKey(facts) === null,
        require: { type: resetType },
      },
    },

    resolvers: {
      [`${PREFIX}${name}_sub_reset`]: {
        requirement: resetType,
        resolve: async (
          _req: unknown,
          context: { facts: Record<string, unknown> },
        ) => {
          context.facts[keyKey] = null;
          context.facts[stateKey] = createIdleResourceState<TData>();
        },
      },
    },

    // The stream arrives from outside, so it is a source, not an effect.
    effects: {},

    sources: {
      [`${PREFIX}${name}_sub`]: {
        key: gateKey,
        attach,
      },
    },

    events: {
      [startedEvent]: (facts, event) => {
        // A new stream resets `isComplete`: the previous stream's terminal
        // signal no longer applies.
        const prevState = facts[stateKey] as ResourceState<TData>;
        facts[keyKey] = event.key;
        facts[stateKey] = {
          ...prevState,
          status: "pending",
          isPending: prevState.data === null,
          isFetching: true,
          isComplete: false,
        };
      },
      [dataEvent]: (facts, event) => {
        const currentState = stateFor(facts, event);
        if (currentState === null) {
          return;
        }
        const value = event.value as TData | ((current: TData | null) => TData);
        const newData =
          typeof value === "function"
            ? (value as (current: TData | null) => TData)(currentState.data)
            : value;
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
      [errorEvent]: (facts, event) => {
        const currentState = stateFor(facts, event);
        if (currentState === null) {
          return;
        }
        const error = event.error as Error;
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
      [completeEvent]: (facts, event) => {
        const currentState = stateFor(facts, event);
        if (currentState === null) {
          return;
        }
        facts[stateKey] = {
          ...currentState,
          isPending: false,
          isFetching: false,
          isComplete: true,
        };
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
