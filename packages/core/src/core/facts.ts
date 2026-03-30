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

import { BLOCKED_PROPS, trackAccess, withoutTracking } from "./tracking.js";
import type {
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
  /** Validate values against schema (default: process.env.NODE_ENV !== 'production') */
  validate?: boolean;
  /** Throw on unknown schema keys (default: true in dev mode) */
  strictKeys?: boolean;
  /** Redact sensitive values in error messages */
  redactErrors?: boolean;
  /** Callback when facts change (for plugin hooks) */
  onChange?: (key: string, value: unknown, prev: unknown) => void;
  /** Callback for batch changes */
  onBatch?: (
    changes: Array<{
      key: string;
      value: unknown;
      prev: unknown;
      type: "set" | "delete";
    }>,
  ) => void;
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
  const { schema, onChange, onBatch } = options;

  // Detect if this is a type assertion schema (empty object with no keys)
  const schemaKeys = Object.keys(schema);
  const isTypeAssertionSchema = schemaKeys.length === 0;

  // Default strictKeys to false for type assertion schemas (they have no runtime keys)
  const validate = options.validate ?? process.env.NODE_ENV !== "production";
  const strictKeys =
    options.strictKeys ??
    (process.env.NODE_ENV !== "production" && !isTypeAssertionSchema);
  const redactErrors = options.redactErrors ?? false;

  const map = new Map<string, unknown>();
  const knownKeys = new Set<string>(); // Track all keys that have been set
  const keyListeners = new Map<string, Set<() => void>>();
  const allListeners = new Set<() => void>();

  let batching = 0;
  const batchChanges: Array<{
    key: string;
    value: unknown;
    prev: unknown;
    type: "set" | "delete";
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
        throw new Error(
          `[Directive] Infinite notification loop detected after ${MAX_NOTIFY_ITERATIONS} iterations${context}.`,
        );
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

    // Notify batch callback
    if (onBatch && batchChanges.length > 0) {
      onBatch([...batchChanges]);
    }

    // Notify key-specific listeners (within coalescing guard)
    if (dirtyKeys.size > 0) {
      isNotifying = true;
      try {
        for (const key of dirtyKeys) {
          notifyKey(key);
        }
        notifyAll();
        drainDeferredNotifications(" during flush");
      } finally {
        isNotifying = false;
      }
    }

    // Clear batch state
    batchChanges.length = 0;
    dirtyKeys.clear();
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
      validateValue(key as string, value);

      const prev = map.get(key as string);

      // Skip if value hasn't changed (prevents unnecessary cascade)
      if (Object.is(prev, value)) return;

      map.set(key as string, value);
      knownKeys.add(key as string); // Track known keys for serialization

      // Record change
      if (batching > 0) {
        batchChanges.push({ key: key as string, value, prev, type: "set" });
        dirtyKeys.add(key as string);
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
        });
        dirtyKeys.add(key as string);
      } else {
        notifyNonBatched(key as string, undefined, prev);
      }
    },

    batch(fn: () => void): void {
      batching++;
      try {
        fn();
      } finally {
        batching--;
        flush();
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
    for (const key of Object.keys(newSchema)) {
      // Defense-in-depth: skip prototype pollution keys
      if (BLOCKED_PROPS.has(key)) continue;
      // Add to schema for validation
      (schema as Record<string, unknown>)[key] = newSchema[key];
      knownKeys.add(key);
    }
  };

  return store;
}

// ============================================================================
// Dev-mode nested mutation warning
// ============================================================================

const nestedProxyCache = new WeakMap<object, object>();

/**
 * Wrap an object in a Proxy that warns when properties are set.
 * Catches `facts.user.name = "John"` which silently skips reactivity.
 * Only used in dev mode — tree-shaken in production builds.
 */
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
      const value = Reflect.get(target, prop);
      if (
        typeof prop === "symbol" ||
        typeof value !== "object" ||
        value === null
      ) {
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
      if (prop === "$store") {
        return store;
      }
      if (prop === "$snapshot") {
        return snapshot;
      }

      // Special properties
      if (typeof prop === "symbol") {
        return undefined;
      }

      // Prototype pollution protection
      if (BLOCKED_PROPS.has(prop)) {
        return undefined;
      }

      const value = store.get(prop as keyof InferSchema<S>);

      // Dev-mode: warn when users mutate nested objects (won't trigger reactivity)
      if (
        process.env.NODE_ENV !== "production" &&
        value !== null &&
        typeof value === "object"
      ) {
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
