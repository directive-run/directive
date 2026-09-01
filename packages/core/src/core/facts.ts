/**
 * Facts Store - Proxy-based reactive state with auto-tracking
 *
 * Features:
 * - Proxy-based access (facts.phase instead of facts.get("phase"))
 * - Automatic dependency tracking via tracking context
 * - Batched updates with coalesced notifications
 * - Granular subscriptions by key
 * - Schema validation in development mode
 */

import isDevelopment from "#is-development";

/**
 * Marks an error the runtime raised to stop a runaway, as opposed to one a
 * consumer threw. Guards that isolate consumer callbacks rethrow these instead
 * of logging them — a loop guard that is caught and swallowed has been
 * disarmed, and doing it per item re-arms it once per item.
 */
export const RUNAWAY: unique symbol = Symbol("directive.runaway");

/** True when `error` was raised by a runtime guard rather than consumer code. */
export function isRunawayError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as Record<symbol, unknown>)[RUNAWAY] === true
  );
}
import {
  BLOCKED_PROPS,
  detectNonJsonValueType,
  trackAccess,
  warnNonJsonFactAssignment,
  withoutTracking,
} from "./tracking.js";
import type {
  FactChange,
  FactOrigin,
  Facts,
  FactsSnapshot,
  FactsStore,
  InferSchema,
  Schema,
} from "./types.js";

/** Safely stringify a value for error messages */
function safeStringify(value: unknown, maxLength = 100): string {
  try {
    return JSON.stringify(value)?.slice(0, maxLength) ?? String(value);
  } catch {
    return "[circular or non-serializable]";
  }
}

// ============================================================================
// Facts Store Implementation
// ============================================================================

/** Options for creating a facts store */
export interface CreateFactsStoreOptions<S extends Schema> {
  schema: S;
  /** Validate values against schema (default: true in development, false in production) */
  validate?: boolean;
  /** Throw on unknown schema keys (default: true in dev mode) */
  strictKeys?: boolean;
  /** Redact sensitive values in error messages */
  redactErrors?: boolean;
  /** Callback when facts change (for plugin hooks) */
  onChange?: (key: string, value: unknown, prev: unknown) => void;
  /** Callback for batch changes */
  onBatch?: (changes: FactChange[]) => void;
  /**
   * Called the moment a key is written inside a batch, before the batch ends.
   *
   * `onBatch` reports the whole batch at the end, which is the right time to
   * *notify* but too late to *invalidate*: a body that writes a fact and then
   * reads a derivation of it in the same breath would read the value from
   * before its own write. The fact itself reads back immediately — the backing
   * map is written at `set()` — so without this the same function body has two
   * consistency models depending on which accessor it reaches for.
   *
   * Only fires while batching. An unbatched write already reaches `onChange`
   * synchronously.
   */
  onWrite?: (key: string) => void;
  /** Called when the outermost batch opens. */
  onBatchStart?: () => void;
  /**
   * Called after `registerKeys` adds fact keys, with the key and its schema
   * type.
   *
   * The store is not the only thing that has to know a fact exists. Anything
   * deciding what a fact carries — and therefore whether writes to it are
   * redacted — has to learn about it at the same moment, or the two disagree
   * with nothing saying so.
   */
  onKeysRegistered?: (
    entries: ReadonlyArray<readonly [string, unknown]>,
  ) => void;
  /**
   * Called after the outermost batch has flushed.
   *
   * A backstop for a batch that wrote nothing: `onBatch` is skipped when there
   * are no changes, so anything paired with `onBatchStart` needs somewhere
   * unconditional to be undone.
   */
  onBatchEnd?: () => void;
  /**
   * Asked, at the moment of each write, where that write came from.
   *
   * Called per write rather than per batch, and that is the whole point. The
   * batch is reported when it ends; a flag read at that moment describes
   * whatever is in effect then, which for a restore nested inside a wider
   * batch is already over. Reading it here records what was true when the
   * value actually changed.
   *
   * Defaults to `"authored"` when not supplied.
   */
  originOf?: () => FactOrigin;
}

/**
 * Create a reactive facts store backed by a Map with schema validation,
 * batched mutations, and granular key-level subscriptions.
 *
 * @remarks
 * The store is the low-level primitive that powers the `facts` proxy.
 * Most users should use {@link createFacts} or `createModule` instead.
 *
 * @param options - Store configuration including schema, validation settings, and change callbacks
 * @returns A {@link FactsStore} with get/set/batch/subscribe methods and automatic schema validation
 *
 * @example
 * ```ts
 * const store = createFactsStore({
 *   schema: { count: t.number(), name: t.string() },
 * });
 *
 * store.set("count", 1);
 * store.get("count"); // 1
 *
 * store.batch(() => {
 *   store.set("count", 2);
 *   store.set("name", "hello");
 * }); // listeners fire once after batch completes
 * ```
 *
 * @internal
 */
export function createFactsStore<S extends Schema>(
  options: CreateFactsStoreOptions<S>,
): FactsStore<S> {
  const {
    schema,
    onChange,
    onBatch,
    onWrite,
    onBatchStart,
    onBatchEnd,
    originOf,
    onKeysRegistered,
  } = options;

  // Detect if this is a type assertion schema (empty object with no keys)
  const schemaKeys = Object.keys(schema);
  const isTypeAssertionSchema = schemaKeys.length === 0;

  // Default strictKeys to false for type assertion schemas (they have no runtime keys)
  const validate = options.validate ?? isDevelopment;
  const strictKeys =
    options.strictKeys ?? (isDevelopment && !isTypeAssertionSchema);
  const redactErrors = options.redactErrors ?? false;

  const map = new Map<string, unknown>();
  const knownKeys = new Set<string>(); // Track all keys that have been set
  const keyListeners = new Map<string, Set<() => void>>();
  /**
   * Keys whose module was unregistered (RFC 0002).
   *
   * A resolver that ignores its abort signal keeps running after teardown, and
   * its writes are documented as landing nowhere. Without this set they landed
   * somewhere: `set` would re-add the key to `map` and `knownKeys`, resurrecting
   * a fact with no schema entry and no tags — so it was invisible to redaction
   * and grew without bound across a rotation.
   */
  const unregisteredKeys = new Set<string>();
  const allListeners = new Set<() => void>();

  let batching = 0;
  const batchChanges: Array<{
    key: string;
    value: unknown;
    prev: unknown;
    type: "set" | "delete";
    origin: FactOrigin;
  }> = [];
  const dirtyKeys = new Set<string>();

  // Notification coalescing: when notifyKey/notifyAll fires a listener that
  // calls store.set(), defer the new notification until the current cycle completes.
  let isNotifying = false;
  const pendingNonBatchedChanges: Array<{
    key: string;
    value: unknown;
    prev: unknown;
  }> = [];
  const MAX_NOTIFY_ITERATIONS = 100;

  /** Check if a value is a Zod schema (robust detection) */
  function isZodSchema(v: unknown): v is {
    safeParse: (v: unknown) => {
      success: boolean;
      error?: { message?: string; issues?: Array<{ message: string }> };
    };
    _def: unknown;
    parse: unknown;
  } {
    return (
      v !== null &&
      typeof v === "object" &&
      "safeParse" in v &&
      typeof (v as Record<string, unknown>).safeParse === "function" &&
      "_def" in v &&
      "parse" in v &&
      typeof (v as Record<string, unknown>).parse === "function"
    );
  }

  /** Get expected type name from schema */
  function getExpectedType(schemaType: unknown): string {
    // Check for our SchemaType with _typeName
    const st = schemaType as { _typeName?: string };
    if (st._typeName) {
      return st._typeName;
    }

    // Check for Zod schema
    if (isZodSchema(schemaType)) {
      const def = (schemaType as { _def?: { typeName?: string } })._def;
      if (def?.typeName) {
        // Convert ZodString -> string, ZodNumber -> number, etc.
        return def.typeName.replace(/^Zod/, "").toLowerCase();
      }
    }

    return "unknown";
  }

  /** Format value for error message, respecting redactErrors option */
  function formatValueForError(value: unknown): string {
    if (redactErrors) {
      return "[redacted]";
    }
    return safeStringify(value);
  }

  /** Get a human-readable type label for a value */
  function describeValueType(value: unknown): string {
    if (value === null) {
      return "null";
    }
    if (Array.isArray(value)) {
      return "array";
    }

    return typeof value;
  }

  /** Validate a value against a Zod schema */
  function validateZod(
    key: string,
    value: unknown,
    schemaType: ReturnType<
      typeof isZodSchema extends (v: unknown) => v is infer R ? () => R : never
    >,
  ): void {
    const result = (
      schemaType as {
        safeParse: (v: unknown) => {
          success: boolean;
          error?: { message?: string; issues?: Array<{ message: string }> };
        };
      }
    ).safeParse(value);
    if (result.success) {
      return;
    }

    const valueType = describeValueType(value);
    const valuePreview = formatValueForError(value);
    const errorMessage =
      result.error?.message ??
      result.error?.issues?.[0]?.message ??
      "Validation failed";
    const expectedType = getExpectedType(schemaType);
    throw new Error(
      `[Directive] Validation failed for "${key}": expected ${expectedType}, got ${valueType} ${valuePreview}. ${errorMessage}`,
    );
  }

  /** Build the index hint string for array validation failures */
  function getIndexHint(st: { _lastFailedIndex?: number }): string {
    if (typeof st._lastFailedIndex === "number" && st._lastFailedIndex >= 0) {
      const hint = ` (element at index ${st._lastFailedIndex} failed)`;
      st._lastFailedIndex = -1; // Reset for next validation
      return hint;
    }

    return "";
  }

  /** Validate a value against our SchemaType validators */
  function validateSchemaType(
    key: string,
    value: unknown,
    st: {
      _validators?: unknown;
      _typeName?: string;
      _lastFailedIndex?: number;
    },
  ): void {
    const validators = st._validators;

    // Ensure validators is an array before iterating
    if (!validators || !Array.isArray(validators) || validators.length === 0) {
      return; // type assertion or empty validators - no validation
    }

    const expectedType = st._typeName ?? "unknown";

    for (let i = 0; i < validators.length; i++) {
      const validator = validators[i];
      if (typeof validator !== "function") continue;
      if (validator(value as never)) continue;

      const valueType = describeValueType(value);
      const valuePreview = formatValueForError(value);
      const indexHint = getIndexHint(st);
      const validatorHint = i === 0 ? "" : ` (validator ${i + 1} failed)`;
      throw new Error(
        `[Directive] Validation failed for "${key}": expected ${expectedType}, got ${valueType} ${valuePreview}${validatorHint}${indexHint}`,
      );
    }
  }

  /** Validate unknown schema key */
  function validateUnknownKey(key: string): void {
    if (strictKeys) {
      throw new Error(
        `[Directive] Unknown fact key: "${key}". Key not defined in schema.`,
      );
    }
    console.warn(`[Directive] Unknown fact key: "${key}"`);
  }

  /** Validate a value against the schema */
  function validateValue(key: string, value: unknown): void {
    if (!validate) {
      return;
    }

    const schemaType = schema[key];
    if (!schemaType) {
      validateUnknownKey(key);
      return;
    }

    if (isZodSchema(schemaType)) {
      validateZod(key, value, schemaType);
      return;
    }

    validateSchemaType(
      key,
      value,
      schemaType as {
        _validators?: unknown;
        _typeName?: string;
        _lastFailedIndex?: number;
      },
    );
  }

  /** Notify listeners for a specific key */
  function notifyKey(key: string): void {
    keyListeners.get(key)?.forEach((listener) => listener());
  }

  /** Notify all listeners */
  function notifyAll(): void {
    allListeners.forEach((listener) => listener());
  }

  /**
   * Run non-batched notifications with coalescing.
   * If a listener calls store.set(), the change is deferred and processed
   * after the current notification cycle completes.
   */
  function notifyNonBatched(key: string, value: unknown, prev: unknown): void {
    if (isNotifying) {
      // Re-entrant: defer to after current notification cycle
      pendingNonBatchedChanges.push({ key, value, prev });
      return;
    }

    isNotifying = true;
    try {
      // Fire onChange, notifyKey, notifyAll for the initial change
      onChange?.(key, value, prev);
      notifyKey(key);
      notifyAll();

      // Process any changes that were deferred during notification
      drainDeferredNotifications(
        ". A listener is repeatedly mutating facts that re-trigger notifications",
      );
    } finally {
      isNotifying = false;
    }
  }

  /**
   * Drain deferred notifications that accumulated during a notification cycle.
   * Must be called while isNotifying is true.
   */
  function drainDeferredNotifications(context: string): void {
    let iterations = 0;
    while (pendingNonBatchedChanges.length > 0) {
      if (++iterations > MAX_NOTIFY_ITERATIONS) {
        pendingNonBatchedChanges.length = 0;
        const runaway = new Error(
          `[Directive] Infinite notification loop detected after ${MAX_NOTIFY_ITERATIONS} iterations${context}.`,
        );
        // Marked so the guards that isolate consumer code can tell this apart
        // from a consumer's own throw and let it through. A runaway that is
        // caught and logged per key is a runaway that has been re-armed once
        // per key, which is the opposite of what a loop guard is for.
        (runaway as Error & { [RUNAWAY]?: true })[RUNAWAY] = true;
        throw runaway;
      }

      const deferred = [...pendingNonBatchedChanges];
      pendingNonBatchedChanges.length = 0;

      for (const change of deferred) {
        onChange?.(change.key, change.value, change.prev);
        notifyKey(change.key);
      }
      notifyAll();
    }
  }

  /** Flush batched changes and notify */
  function flush(): void {
    if (batching > 0) {
      return;
    }

    // Take the batch and CLEAR IT before anything downstream runs.
    //
    // Consumer code runs during the notify phase below, and a listener is
    // allowed to open a nested batch. While this state stayed populated until
    // after that phase, the nested flush saw the outer batch's changes still
    // sitting in the buffer and reported them a second time. Three writes
    // produced five records, the duplicates carried pre-write values, and the
    // last recorded value for a key was the one it held BEFORE the batch — so
    // anything reconstructing state from that stream got it wrong.
    //
    // Nothing is lost by clearing early: a write made during the notify phase
    // lands in the now-empty buffer and is reported by its own flush.
    const changes = batchChanges.length > 0 ? [...batchChanges] : null;
    const keys = dirtyKeys.size > 0 ? [...dirtyKeys] : null;
    batchChanges.length = 0;
    dirtyKeys.clear();

    // Notify batch callback
    if (onBatch && changes) {
      onBatch(changes);
    }

    // Notify key-specific listeners (within coalescing guard)
    if (keys) {
      isNotifying = true;
      try {
        for (const key of keys) {
          notifyKey(key);
        }
        notifyAll();
        drainDeferredNotifications(" during flush");
      } finally {
        isNotifying = false;
      }
    }
  }

  const store: FactsStore<S> = {
    get<K extends keyof InferSchema<S>>(key: K): InferSchema<S>[K] | undefined {
      // Track access for auto-tracking
      trackAccess(key as string);
      return map.get(key as string) as InferSchema<S>[K] | undefined;
    },

    has(key: keyof InferSchema<S>): boolean {
      // Track access for auto-tracking
      trackAccess(key as string);
      return map.has(key as string);
    },

    set<K extends keyof InferSchema<S>>(
      key: K,
      value: InferSchema<S>[K],
    ): void {
      // Checked BEFORE validation, deliberately. A write to a key whose module
      // was unregistered lands nowhere, which is what the API promises for a
      // resolver that ignored its abort signal — and validation would instead
      // throw "unknown fact key", because the schema entry is exactly what
      // unregistering removes. Behind validation this guard was unreachable in
      // development, so the documented behaviour held only in production, and
      // an orphaned timer or stream callback raised in user code.
      if (unregisteredKeys.has(key as string)) return;

      if (isDevelopment) validateValue(key as string, value);

      const prev = map.get(key as string);

      // Skip if value hasn't changed (prevents unnecessary cascade)
      if (Object.is(prev, value)) return;

      map.set(key as string, value);
      knownKeys.add(key as string); // Track known keys for serialization

      // Record change
      if (batching > 0) {
        batchChanges.push({
          key: key as string,
          value,
          prev,
          type: "set",
          origin: originOf?.() ?? "authored",
        });
        dirtyKeys.add(key as string);
        onWrite?.(key as string);
      } else {
        notifyNonBatched(key as string, value, prev);
      }
    },

    delete(key: keyof InferSchema<S>): void {
      const prev = map.get(key as string);
      map.delete(key as string);
      knownKeys.delete(key as string); // Remove from known keys

      // Record change
      if (batching > 0) {
        batchChanges.push({
          key: key as string,
          value: undefined,
          prev,
          type: "delete",
          origin: originOf?.() ?? "authored",
        });
        dirtyKeys.add(key as string);
        onWrite?.(key as string);
      } else {
        notifyNonBatched(key as string, undefined, prev);
      }
    },

    batch(fn: () => void): void {
      const outermost = batching === 0;
      batching++;
      if (outermost) {
        onBatchStart?.();
      }
      try {
        fn();
      } finally {
        batching--;
        // `onBatchEnd` pairs with `onBatchStart` on every exit, including a
        // throw out of the flush. Anything scoped to the batch — the engine's
        // derivation hold, for one — is given back rather than stranded.
        try {
          flush();
        } finally {
          // After `flush()`, so whatever `onBatch` did during the flush is
          // inside the scope that opened.
          if (outermost) {
            onBatchEnd?.();
          }
        }
      }
    },

    subscribe(
      keys: Array<keyof InferSchema<S>>,
      listener: () => void,
    ): () => void {
      for (const key of keys) {
        const keyStr = key as string;
        if (!keyListeners.has(keyStr)) {
          keyListeners.set(keyStr, new Set());
        }
        keyListeners.get(keyStr)!.add(listener);
      }

      return () => {
        for (const key of keys) {
          const set = keyListeners.get(key as string);
          if (set) {
            set.delete(listener);
            if (set.size === 0) {
              keyListeners.delete(key as string);
            }
          }
        }
      };
    },

    subscribeAll(listener: () => void): () => void {
      allListeners.add(listener);
      return () => allListeners.delete(listener);
    },

    toObject(): Record<string, unknown> {
      const result: Record<string, unknown> = {};
      for (const key of knownKeys) {
        if (map.has(key)) {
          result[key] = map.get(key);
        }
      }
      return result;
    },
  };

  // Internal: clear all listeners on destroy to release resources immediately.
  // Not part of the public FactsStore interface — called by engine.destroy().
  (store as unknown as Record<string, unknown>).destroy = () => {
    keyListeners.clear();
    allListeners.clear();
  };

  // Internal: register new schema keys for dynamic module registration.
  // Not part of the public FactsStore interface — used by engine.registerModule().
  (store as unknown as Record<string, unknown>).registerKeys = (
    newSchema: Record<string, unknown>,
  ) => {
    const added: string[] = [];
    for (const key of Object.keys(newSchema)) {
      // Defense-in-depth: skip prototype pollution keys
      if (BLOCKED_PROPS.has(key)) continue;
      // Replacing an existing key would swap its declared type and its meta —
      // including the tags that decide whether writes to it get redacted.
      // `registerModule` refuses a duplicate fact key before it gets here, and
      // then hands us the very objects it just merged, so an identical
      // reference is that no-op and not an overwrite. A DIFFERENT declaration
      // for a key we already hold is the untag, and it is refused.
      const existing = (schema as Record<string, unknown>)[key];
      if (
        Object.hasOwn(schema as Record<string, unknown>, key) &&
        existing !== newSchema[key]
      ) {
        throw new Error(
          `[Directive] Cannot re-declare fact "${key}". A fact's type and its tags are fixed once registered — replacing the declaration would silently change what gets redacted.`,
        );
      }
      // Add to schema for validation
      (schema as Record<string, unknown>)[key] = newSchema[key];
      knownKeys.add(key);
      // A name coming back is live again. Leaving it marked would make the
      // replacement instance silently unwritable — the rotation would appear to
      // work and then hold its opening values forever.
      unregisteredKeys.delete(key);
      added.push(key);
    }
    // Tell the engine, so a key registered through the store is recorded the
    // same way one registered through a module is. Without this a fact could
    // be tagged `pii` in every query surface and untagged to the screen that
    // acts on it — permanently, and with nothing reporting the difference.
    if (added.length > 0) {
      onKeysRegistered?.(added.map((k) => [k, newSchema[k]] as const));
    }
  };

  // Internal: drop schema keys when a module is unregistered (RFC 0002).
  // Not part of the public FactsStore interface — used by engine.unregisterModule().
  //
  // The declaration is removed, not merely the value. `registerKeys` refuses to
  // re-declare a key it already holds, because swapping a declaration would
  // swap the tags that decide what gets redacted. A module registered again
  // under the same name brings freshly-built schema objects, so leaving the old
  // declaration behind would make re-registration throw — the one thing this
  // whole API exists to allow.
  (store as unknown as Record<string, unknown>).unregisterKeys = (
    keys: readonly string[],
  ) => {
    // One batch for the whole module, not one notification per fact. Notifying
    // per key published every torn intermediate state — a watcher on a
    // three-fact module saw the first key gone while the other two remained,
    // then the second, then the third. Three renders of states that never
    // existed, scaling with the module's fact count.
    store.batch(() => {
      for (const key of keys) {
        const prev = map.get(key);
        map.delete(key);
        knownKeys.delete(key);
        delete (schema as Record<string, unknown>)[key];
        unregisteredKeys.add(key);
        // Announced, not silent. Invalidation walks the dependency index only
        // when a change is reported, so removing values quietly left a
        // derivation in another module holding its cached value forever —
        // a number for something that no longer existed.
        batchChanges.push({
          key,
          value: undefined,
          prev,
          type: "delete",
          origin: originOf?.() ?? "authored",
        });
        dirtyKeys.add(key);
        onWrite?.(key);
      }
    });
    // Listeners are deliberately NOT dropped. A key coming back under the same
    // name is the headline use case, not an edge case, and a subscriber that
    // survived the rotation must keep working. Dropping them silently killed
    // every `useFact` and `system.subscribe` across a re-register.
  };

  return store;
}

// ============================================================================
// Dev-mode nested mutation warning
// ============================================================================

const nestedProxyCache = new WeakMap<object, object>();

/**
 * Reads the object a dev warning Proxy wraps, or `undefined` for anything else.
 *
 * The wrapper is a development aid, but it does not stay on the read path: the
 * documented immutable update `facts.doc = { ...facts.doc, title }` reads every
 * nested value THROUGH the wrapper and spreads the results into a new object,
 * so the wrappers are stored. From then on the fact holds Proxies where the
 * author put a `Date` or a `Map`.
 *
 * That matters because `structuredClone` refuses a Proxy, and cloning is how
 * state crosses every boundary in this codebase — history snapshots, optimistic
 * rollback, worker `postMessage`, distributable snapshots. A dev-only aid was
 * making dev-mode state uncloneable.
 */
export const DEV_PROXY_TARGET: unique symbol = Symbol.for(
  "directive.devProxyTarget",
);

/**
 * Recursively replace dev warning Proxies with the objects they wrap.
 *
 * Returns the input untouched when there is nothing to unwrap, so callers can
 * use the result unconditionally. Only reachable in development: production
 * builds never create the wrappers.
 */
export function unwrapDevProxies<T>(value: T, seen = new WeakSet()): T {
  if (typeof value !== "object" || value === null) return value;

  const target = (value as { [DEV_PROXY_TARGET]?: object })[DEV_PROXY_TARGET];
  const source = (target ?? value) as object;

  // Cycles are legal in facts and `structuredClone` handles them, so the walk
  // has to as well rather than recursing forever.
  if (seen.has(source)) return source as T;
  seen.add(source);

  if (Array.isArray(source)) {
    return source.map((item) => unwrapDevProxies(item, seen)) as T;
  }
  // Anything with internal slots — Date, Map, Set, TypedArray, RegExp — is
  // returned whole. Walking its properties would produce a plain object and
  // lose exactly what makes it that type.
  if (Object.getPrototypeOf(source) !== Object.prototype) {
    return source as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    out[key] = unwrapDevProxies(item, seen);
  }

  return out as T;
}

/**
 * Wrap an object in a Proxy that warns when properties are set.
 * Catches `facts.user.name = "John"` which silently skips reactivity.
 * Only used in dev mode — tree-shaken in production builds.
 */
/** Is this value one of the development-mode warning wrappers? */
function isDevProxy(value: unknown): boolean {
  return (
    (value as { [DEV_PROXY_TARGET]?: object })[DEV_PROXY_TARGET] !== undefined
  );
}

function wrapWithNestedWarning(
  obj: object,
  rootKey: string,
  path = rootKey,
): object {
  return new Proxy(obj, {
    get(target, prop) {
      if (typeof prop === "string" && BLOCKED_PROPS.has(prop)) {
        return undefined;
      }
      // Inspection hook: return a snapshot function that yields the
      // unwrapped target so printers (`util.inspect`, vitest
      // pretty-format) render the underlying object directly rather
      // than the warning-wrapped Proxy. `Symbol.toPrimitive` is left
      // alone — the protocol requires a primitive return.
      // Unwrap hatch. Cloning refuses a Proxy, and these wrappers end up
      // stored, so anything that has to serialize state needs a way back to
      // the real object.
      if (prop === DEV_PROXY_TARGET) {
        return target;
      }
      if (prop === Symbol.for("nodejs.util.inspect.custom")) {
        return () => target;
      }
      const value = Reflect.get(target, prop);
      if (
        typeof prop === "symbol" ||
        typeof value !== "object" ||
        value === null
      ) {
        return value;
      }

      // Already one of ours — hand it back rather than wrapping it again.
      //
      // These wrappers get *stored*: the ordinary way to update an object fact is
      // `facts.map = { ...facts.map, k: v }`, which copies whatever the store just
      // handed back into the new object. Without this check every such update adds
      // a layer, so read cost grows with the number of writes and the whole chain
      // stays live. Silent, and compounding — an eight-key map measured 38 ms for
      // 5,000 reads after 8 writes and 8,164 ms after 108.
      if (isDevProxy(value)) {
        return value;
      }

      // Only plain objects and arrays are wrapped.
      //
      // The warning this wrapper exists for is about *properties* —
      // `facts.user.name = "x"` skipping reactivity. A Map's or a Set's contents
      // are not properties; they live in an internal slot no proxy can reach. So
      // wrapping one buys no warning and costs the object's own methods, because
      // `Set.prototype.has` called on a Proxy throws "called on incompatible
      // receiver". Same for `Map`, `Date`, typed arrays and any class instance
      // whose state is not enumerable own properties.
      //
      // Dev-only, which is the worst part: the wrapper is tree-shaken out of
      // production, so a `Map` in a fact works in the shipped bundle and throws
      // in the test suite.
      const valuePrototype = Object.getPrototypeOf(value);
      if (
        valuePrototype !== Object.prototype &&
        valuePrototype !== null &&
        !Array.isArray(value)
      ) {
        return value;
      }

      // A frozen container's properties are non-configurable and non-writable,
      // and a Proxy is required to return the target's own value for those. A
      // wrapper here is not a warning, it is a TypeError on the read — so
      // `Object.freeze`, the ordinary way to make a stored value immutable,
      // makes the value unreadable in development and works in production,
      // where this wrapper is tree-shaken away.
      //
      // Returning the raw value loses nothing: a frozen property cannot be
      // mutated, so there is no nested mutation left to warn about.
      const descriptor = Object.getOwnPropertyDescriptor(target, prop);
      if (descriptor && !descriptor.configurable && !descriptor.writable) {
        return value;
      }
      if (nestedProxyCache.has(value as object)) {
        return nestedProxyCache.get(value as object);
      }

      const wrapped = wrapWithNestedWarning(
        value as object,
        rootKey,
        `${path}.${String(prop)}`,
      );
      nestedProxyCache.set(value as object, wrapped);

      return wrapped;
    },
    set(target, prop, newValue) {
      if (typeof prop !== "symbol") {
        console.warn(
          `[Directive] Nested mutation on "facts.${path}.${String(prop)}" will not trigger reactivity. ` +
            `Use: facts.${rootKey} = { ...facts.${rootKey}, ... }`,
        );
      }

      return Reflect.set(target, prop, newValue);
    },
  });
}

// ============================================================================
// Proxy-based Facts Accessor
// ============================================================================

/**
 * Create a Proxy wrapper around a {@link FactsStore} for clean property-style
 * access (`facts.phase`) with automatic dependency tracking.
 *
 * @remarks
 * Reading a property calls `store.get()` (which tracks the access for
 * auto-tracked derivations). Writing a property calls `store.set()` (which
 * validates against the schema). The proxy also exposes `$store` for direct
 * store access and `$snapshot()` for untracked reads.
 *
 * @param store - The underlying facts store to wrap
 * @param schema - The schema definition used for `ownKeys` enumeration
 * @returns A {@link Facts} proxy with property-style get/set and prototype pollution guards
 *
 * @example
 * ```ts
 * const store = createFactsStore({ schema: { phase: t.string() } });
 * const facts = createFactsProxy(store, { phase: t.string() });
 *
 * facts.phase = "red";
 * console.log(facts.phase); // "red"
 * ```
 *
 * @internal
 */
export function createFactsProxy<S extends Schema>(
  store: FactsStore<S>,
  schema: S,
): Facts<S> {
  const snapshot = (): FactsSnapshot<S> => ({
    get: <K extends keyof InferSchema<S>>(key: K) =>
      withoutTracking(() => store.get(key)),
    has: (key: keyof InferSchema<S>) => withoutTracking(() => store.has(key)),
  });

  const proxy = new Proxy({} as Facts<S>, {
    get(_, prop: string | symbol) {
      // Fast path: symbols (React probes $$typeof, Symbol.toPrimitive, etc.)
      if (typeof prop === "symbol") {
        // Inspection hook: return a snapshot function so vitest's
        // pretty-format / Node `util.inspect` / `console.log` render the
        // facts correctly without reflectively walking the Proxy (which
        // crashes `printComplexValue` reading `val.constructor.name`).
        //
        // We deliberately do NOT add `toJSON` here — that would change
        // `JSON.stringify(facts)` semantics for users already relying on
        // the current shape. We also do not override `Symbol.toPrimitive`:
        // the protocol requires a primitive return, and returning an
        // object snapshot from there would TypeError.
        if (prop === Symbol.for("nodejs.util.inspect.custom")) {
          return () => withoutTracking(() => store.toObject());
        }
        return undefined;
      }

      // Fast path: prototype pollution guard
      if (BLOCKED_PROPS.has(prop)) {
        return undefined;
      }

      // Internal accessors (rare in hot loops)
      if (prop === "$store") {
        return store;
      }
      if (prop === "$snapshot") {
        return snapshot;
      }

      // Happy path: read from store
      const value = store.get(prop as keyof InferSchema<S>);

      // Dev-mode: warn when users mutate nested objects (won't trigger reactivity)
      if (isDevelopment && value !== null && typeof value === "object") {
        // A wrapper written straight back in is already wrapped — see the note in
        // `wrapWithNestedWarning`. Re-wrapping it here is the same accumulation
        // one level up.
        if (isDevProxy(value)) {
          return value;
        }

        return wrapWithNestedWarning(value as object, prop);
      }

      return value;
    },

    set(_, prop: string | symbol, value: unknown) {
      if (typeof prop === "symbol") {
        return false;
      }
      if (prop === "$store" || prop === "$snapshot") {
        return false;
      }
      // Prototype pollution protection
      if (BLOCKED_PROPS.has(prop)) {
        return false;
      }

      // Dev-mode: warn (once per path/type) when assigning non-JSON values
      // that break reactivity. Date/Set/Map/File/class-instance mutations
      // are not tracked. Per Architecture + Risk reviewers we WARN ONLY
      // (no auto-coerce) — coercion would change equality semantics for
      // users relying on identity / iteration order.
      if (isDevelopment) {
        const nonJsonType = detectNonJsonValueType(value);
        if (nonJsonType) {
          warnNonJsonFactAssignment(prop, nonJsonType);
        }
      }

      // Validation is handled by store.set() when validate option is enabled
      store.set(
        prop as keyof InferSchema<S>,
        value as InferSchema<S>[keyof InferSchema<S>],
      );
      return true;
    },

    deleteProperty(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return false;
      }
      if (prop === "$store" || prop === "$snapshot") {
        return false;
      }
      // Prototype pollution protection
      if (BLOCKED_PROPS.has(prop)) {
        return false;
      }

      store.delete(prop as keyof InferSchema<S>);
      return true;
    },

    has(_, prop: string | symbol) {
      if (prop === "$store" || prop === "$snapshot") {
        return true;
      }
      if (typeof prop === "symbol") {
        return false;
      }
      // Prototype pollution protection
      if (BLOCKED_PROPS.has(prop)) {
        return false;
      }

      return store.has(prop as keyof InferSchema<S>);
    },

    ownKeys() {
      // Return schema keys dynamically so Object.keys(facts) reflects
      // keys added via registerKeys (dynamic module registration)
      return Object.keys(schema);
    },

    getOwnPropertyDescriptor(_, prop: string | symbol) {
      // Keep `getOwnPropertyDescriptor` consistent with the `get` trap, which
      // blocks these — otherwise `Object.hasOwn(facts, "__proto__")` would
      // return true while `facts.__proto__` returns undefined.
      if (typeof prop === "string" && BLOCKED_PROPS.has(prop)) {
        return undefined;
      }
      if (prop === "$store" || prop === "$snapshot") {
        return { configurable: true, enumerable: false, writable: false };
      }
      return { configurable: true, enumerable: true, writable: true };
    },

    defineProperty() {
      return false;
    },

    getPrototypeOf() {
      return null;
    },

    setPrototypeOf() {
      return false;
    },
  });

  return proxy;
}

// ============================================================================
// Combined Factory
// ============================================================================

/**
 * Convenience factory that creates both a {@link FactsStore} and its
 * {@link createFactsProxy | proxy wrapper} in a single call.
 *
 * @remarks
 * This is the recommended entry point when you need low-level store access
 * outside of `createModule` / `createSystem`.
 *
 * @param options - Same options as {@link createFactsStore}
 * @returns An object with `store` (the reactive Map-backed store) and `facts` (the Proxy accessor)
 *
 * @example
 * ```ts
 * const { store, facts } = createFacts({
 *   schema: { phase: t.string<"red" | "green">() },
 * });
 *
 * facts.phase = "red";
 * console.log(facts.phase); // "red"
 * store.subscribe(["phase"], () => console.log("phase changed"));
 * ```
 *
 * @internal
 */
export function createFacts<S extends Schema>(
  options: CreateFactsStoreOptions<S>,
): { store: FactsStore<S>; facts: Facts<S> } {
  const store = createFactsStore(options);
  const facts = createFactsProxy(store, options.schema);
  return { store, facts };
}
