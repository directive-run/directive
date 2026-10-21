/**
 * Facts: the 1.35 facts store and proxy, with every value held in a node of
 * the new reactive graph.
 *
 * A read inside a derivation is tracked by the graph itself (a node read
 * while a computed runs links to it). The store's own listener and batching
 * rules are the 1.35 ones, so subscribers see the same notifications in the
 * same order. Each store owns its graph unless one is passed in; nothing here
 * is module-level mutable state.
 */

import isDevelopment from "#is-development";
import { Graph, type ReactiveNode } from "../graph.js";
import type {
  FactChange,
  FactOrigin,
  Facts,
  FactsSnapshot,
  FactsStore,
  InferSchema,
  Schema,
} from "./types.js";

export const RUNAWAY: unique symbol = Symbol("directive.runaway");

export function isRunawayError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as Record<symbol, unknown>)[RUNAWAY] === true
  );
}

export const BLOCKED_PROPS: ReadonlySet<string> = Object.freeze(
  new Set(["__proto__", "constructor", "prototype"]),
);

/** Per-system tracking: what the running derivation or effect read. */
export interface Tracker {
  /** Fact keys and `\u001F`-prefixed derivation ids read in this frame. */
  deps: Set<string> | null;
}

export const DERIVATION_DEP_PREFIX = "\u001F";
export const describeDep = (dep: string): string =>
  dep.startsWith(DERIVATION_DEP_PREFIX)
    ? `derive.${dep.slice(1)}`
    : dep;

export function withTracking<T>(
  tracker: Tracker,
  fn: () => T,
): { value: T; deps: Set<string> } {
  const prev = tracker.deps;
  const deps = new Set<string>();
  tracker.deps = deps;
  try {
    return { value: fn(), deps };
  } finally {
    tracker.deps = prev;
  }
}

export function withoutTracking<T>(tracker: Tracker, fn: () => T): T {
  const prev = tracker.deps;
  tracker.deps = null;
  try {
    return fn();
  } finally {
    tracker.deps = prev;
  }
}

export interface CreateFactsStoreOptions<S extends Schema> {
  schema: S;
  validate?: boolean;
  strictKeys?: boolean;
  redactErrors?: boolean;
  onChange?: (key: string, value: unknown, prev: unknown) => void;
  onBatch?: (changes: FactChange[]) => void;
  onWrite?: (key: string) => void;
  onBatchStart?: () => void;
  onBatchEnd?: () => void;
  originOf?: () => FactOrigin;
  /** The graph to hold values in (a system passes its own). */
  graph?: Graph;
  tracker?: Tracker;
  /** Filled with each key's graph node (a system walks their subscribers). */
  nodes?: Map<string, ReactiveNode>;
}

export function safeStringify(data: unknown, maxLen = 500): string {
  try {
    const str = JSON.stringify(
      data,
      (_k, v) => (typeof v === "bigint" ? `${v}n` : v),
      2,
    );
    if (!str) {
      return "[undefined]";
    }

    return str.length <= maxLen
      ? str
      : `${str.slice(0, maxLen)}\n... (truncated, ${str.length} chars total)`;
  } catch {
    return "[unserializable]";
  }
}

function isZodSchema(v: unknown): boolean {
  const o = v as Record<string, unknown>;

  return (
    v !== null &&
    typeof v === "object" &&
    typeof o.safeParse === "function" &&
    "_def" in o &&
    typeof o.parse === "function"
  );
}

const typeLabel = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

export function createFactsStore<S extends Schema>(
  options: CreateFactsStoreOptions<S>,
): FactsStore<S> {
  const { schema, onChange, onBatch, onWrite, onBatchStart, onBatchEnd } =
    options;
  const originOf = options.originOf ?? (() => "authored" as FactOrigin);
  const graph = options.graph ?? new Graph();
  const tracker = options.tracker ?? { deps: null };
  const isTypeAssertionSchema = Object.keys(schema).length === 0;
  const validate = options.validate ?? isDevelopment;
  const strictKeys =
    options.strictKeys ?? (isDevelopment && !isTypeAssertionSchema);
  const redactErrors = options.redactErrors ?? false;

  /** One graph node per key; `present` says whether the key holds a value. */
  const nodes = options.nodes ?? new Map<string, ReactiveNode>();
  const present = new Set<string>();
  const keyListeners = new Map<string, Set<() => void>>();
  const allListeners = new Set<() => void>();
  let batching = 0;
  const batchChanges: FactChange[] = [];
  const dirtyKeys = new Set<string>();
  let isNotifying = false;
  const pending: Array<{ key: string; value: unknown; prev: unknown }> = [];

  const node = (key: string): ReactiveNode => {
    let n = nodes.get(key);
    if (!n) {
      n = graph.signal<unknown>(undefined, { equals: false });
      nodes.set(key, n);
    }

    return n;
  };
  const track = (key: string): ReactiveNode => {
    tracker.deps?.add(key);
    const n = node(key);
    graph.read(n);

    return n;
  };
  const preview = (value: unknown) =>
    redactErrors ? "[redacted]" : safeStringify(value);

  function validateValue(key: string, value: unknown): void {
    if (!validate) {
      return;
    }
    const st = (schema as Record<string, unknown>)[key] as
      | Record<string, any>
      | undefined;
    if (!st) {
      if (strictKeys) {
        throw new Error(
          `[Directive] Unknown fact key: "${key}". Key not defined in schema.`,
        );
      }
      console.warn(`[Directive] Unknown fact key: "${key}"`);

      return;
    }
    if (isZodSchema(st)) {
      const result = st.safeParse(value);
      if (result.success) {
        return;
      }
      const message =
        result.error?.message ??
        result.error?.issues?.[0]?.message ??
        "Validation failed";
      const expected = st._typeName
        ? st._typeName
        : st._def?.typeName
          ? String(st._def.typeName).replace(/^Zod/, "").toLowerCase()
          : "unknown";
      throw new Error(
        `[Directive] Validation failed for "${key}": expected ${expected}, got ${typeLabel(value)} ${preview(value)}. ${message}`,
      );
    }
    const validators = st._validators;
    if (!Array.isArray(validators) || validators.length === 0) {
      return;
    }
    for (let i = 0; i < validators.length; i++) {
      const validator = validators[i];
      if (typeof validator !== "function" || validator(value)) {
        continue;
      }
      let indexHint = "";
      if (typeof st._lastFailedIndex === "number" && st._lastFailedIndex >= 0) {
        indexHint = ` (element at index ${st._lastFailedIndex} failed)`;
        st._lastFailedIndex = -1;
      }
      throw new Error(
        `[Directive] Validation failed for "${key}": expected ${st._typeName ?? "unknown"}, got ${typeLabel(value)} ${preview(value)}${i === 0 ? "" : ` (validator ${i + 1} failed)`}${indexHint}`,
      );
    }
  }

  const notifyKey = (key: string) =>
    keyListeners.get(key)?.forEach((listener) => listener());
  const notifyAll = () => allListeners.forEach((listener) => listener());

  function drain(context: string): void {
    let iterations = 0;
    while (pending.length > 0) {
      if (++iterations > 100) {
        pending.length = 0;
        const runaway = new Error(
          `[Directive] Infinite notification loop detected after 100 iterations${context}.`,
        );
        (runaway as unknown as Record<symbol, unknown>)[RUNAWAY] = true;
        throw runaway;
      }
      const deferred = pending.splice(0);
      for (const change of deferred) {
        onChange?.(change.key, change.value, change.prev);
        notifyKey(change.key);
      }
      notifyAll();
    }
  }

  function notifyNow(key: string, value: unknown, prev: unknown): void {
    if (isNotifying) {
      pending.push({ key, value, prev });

      return;
    }
    isNotifying = true;
    try {
      onChange?.(key, value, prev);
      notifyKey(key);
      notifyAll();
      drain(
        ". A listener is repeatedly mutating facts that re-trigger notifications",
      );
    } finally {
      isNotifying = false;
    }
  }

  function flush(): void {
    if (batching > 0) {
      return;
    }
    const changes = batchChanges.length > 0 ? batchChanges.splice(0) : null;
    const keys = dirtyKeys.size > 0 ? [...dirtyKeys] : null;
    dirtyKeys.clear();
    if (onBatch && changes) {
      onBatch(changes);
    }
    if (keys) {
      isNotifying = true;
      try {
        for (const key of keys) {
          notifyKey(key);
        }
        notifyAll();
        drain(" during flush");
      } finally {
        isNotifying = false;
      }
    }
  }

  function record(
    key: string,
    value: unknown,
    prev: unknown,
    type: "set" | "delete",
  ): void {
    if (batching > 0) {
      batchChanges.push({ key, value, prev, type, origin: originOf() });
      dirtyKeys.add(key);
      onWrite?.(key);
    } else {
      notifyNow(key, value, prev);
    }
  }

  const store: FactsStore<S> = {
    get(key: any) {
      return track(key as string).value as any;
    },
    has(key: any) {
      track(key as string);

      return present.has(key as string);
    },
    set(key: any, value: any) {
      const k = key as string;
      if (isDevelopment) {
        validateValue(k, value);
      }
      const n = node(k);
      const prev = n.value;
      if (Object.is(prev, value)) {
        return;
      }
      present.add(k);
      graph.write(n, value);
      record(k, value, prev, "set");
    },
    delete(key: any) {
      const k = key as string;
      const n = node(k);
      const prev = n.value;
      present.delete(k);
      graph.write(n, undefined);
      record(k, undefined, prev, "delete");
    },
    batch(fn: () => void) {
      const outermost = batching === 0;
      batching++;
      if (outermost) {
        onBatchStart?.();
      }
      try {
        graph.batch(fn);
      } finally {
        batching--;
        try {
          flush();
        } finally {
          if (outermost) {
            onBatchEnd?.();
          }
        }
      }
    },
    subscribe(keys: any[], listener: () => void) {
      for (const key of keys as string[]) {
        let set = keyListeners.get(key);
        if (!set) {
          keyListeners.set(key, (set = new Set()));
        }
        set.add(listener);
      }

      return () => {
        for (const key of keys as string[]) {
          const set = keyListeners.get(key);
          set?.delete(listener);
          if (set?.size === 0) {
            keyListeners.delete(key);
          }
        }
      };
    },
    subscribeAll(listener: () => void) {
      allListeners.add(listener);

      return () => {
        allListeners.delete(listener);
      };
    },
    toObject() {
      const out: Record<string, unknown> = {};
      for (const key of present) {
        out[key] = nodes.get(key)!.value;
      }

      return out;
    },
  } as FactsStore<S>;
  (store as unknown as Record<string, unknown>).destroy = () => {
    keyListeners.clear();
    allListeners.clear();
  };

  return store;
}

const DEV_PROXY_TARGET = Symbol.for("directive.devProxyTarget");
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/** Values whose mutations a fact cannot see; facts should be JSON. */
export function detectNonJsonValueType(value: unknown): string | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  if (value instanceof Date) {
    return "Date";
  }
  if (value instanceof Set) {
    return "Set";
  }
  if (value instanceof Map) {
    return "Map";
  }
  if (typeof File !== "undefined" && value instanceof File) {
    return "File";
  }
  if (Array.isArray(value)) {
    return null;
  }
  const proto = Object.getPrototypeOf(value);

  return proto !== null && proto !== Object.prototype ? "ClassInstance" : null;
}

const NON_JSON_HINTS: Record<string, string> = {
  Date: ".getTime() for timestamps",
  Set: "[...set] for arrays",
  Map: "Object.fromEntries(map) for plain objects",
  File: "{ name, size, type, lastModified } for metadata",
  ClassInstance: "a plain-object snapshot",
};

/** Warn once per key and type; the cache belongs to the caller (a system). */
export function warnNonJson(
  cache: Set<string>,
  factPath: string,
  valueType: string,
): void {
  const cacheKey = `${factPath}|${valueType}`;
  if (cache.has(cacheKey)) {
    return;
  }
  if (cache.size >= 1000) {
    cache.delete(cache.values().next().value as string);
  }
  cache.add(cacheKey);
  const hint = NON_JSON_HINTS[valueType] ?? "a JSON-roundtrippable value";
  console.warn(
    `[Directive] Fact "${factPath}" assigned a ${valueType} instance.\nFacts must be JSON-roundtrippable for reactivity to work correctly.\n${valueType} mutations are not tracked.\nUse ${hint} instead.\nSee: https://directive.run/docs/facts#json-rule`,
  );
}

function wrapNested(
  cache: WeakMap<object, object>,
  obj: object,
  rootKey: string,
  path = rootKey,
): object {
  return new Proxy(obj, {
    get(target, prop) {
      if (typeof prop === "string" && BLOCKED_PROPS.has(prop)) {
        return undefined;
      }
      if (prop === DEV_PROXY_TARGET) {
        return target;
      }
      if (prop === INSPECT) {
        return () => target;
      }
      const value = Reflect.get(target, prop);
      if (typeof prop === "symbol" || typeof value !== "object" || !value) {
        return value;
      }
      if ((value as Record<symbol, unknown>)[DEV_PROXY_TARGET] !== undefined) {
        return value;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null && !Array.isArray(value)) {
        return value;
      }
      const d = Object.getOwnPropertyDescriptor(target, prop);
      if (d && !d.configurable && !d.writable) {
        return value;
      }
      let wrapped = cache.get(value);
      if (!wrapped) {
        wrapped = wrapNested(cache, value, rootKey, `${path}.${String(prop)}`);
        cache.set(value, wrapped);
      }

      return wrapped;
    },
    set(target, prop, next) {
      if (typeof prop !== "symbol") {
        console.warn(
          `[Directive] Nested mutation on "facts.${path}.${String(prop)}" will not trigger reactivity. Use: facts.${rootKey} = { ...facts.${rootKey}, ... }`,
        );
      }

      return Reflect.set(target, prop, next);
    },
  });
}

export function createFactsProxy<S extends Schema>(
  store: FactsStore<S>,
  schema: S,
  tracker: Tracker = { deps: null },
  warned: Set<string> = new Set(),
): Facts<S> {
  const nested = new WeakMap<object, object>();
  const snapshot = (): FactsSnapshot<S> => ({
    get: (key) => withoutTracking(tracker, () => store.get(key)),
    has: (key) => withoutTracking(tracker, () => store.has(key)),
  });
  const reserved = (prop: string | symbol): boolean =>
    typeof prop === "symbol" ||
    prop === "$store" ||
    prop === "$snapshot" ||
    BLOCKED_PROPS.has(prop);

  return new Proxy({} as Facts<S>, {
    get(_, prop) {
      if (typeof prop === "symbol") {
        return prop === INSPECT
          ? () => withoutTracking(tracker, () => store.toObject())
          : undefined;
      }
      if (BLOCKED_PROPS.has(prop)) {
        return undefined;
      }
      if (prop === "$store") {
        return store;
      }
      if (prop === "$snapshot") {
        return snapshot;
      }
      const value = store.get(prop as keyof InferSchema<S>);
      if (isDevelopment && value !== null && typeof value === "object") {
        if ((value as Record<symbol, unknown>)[DEV_PROXY_TARGET] !== undefined) {
          return value;
        }

        return wrapNested(nested, value as object, prop);
      }

      return value;
    },
    set(_, prop, value) {
      if (reserved(prop)) {
        return false;
      }
      if (isDevelopment) {
        const nonJson = detectNonJsonValueType(value);
        if (nonJson) {
          warnNonJson(warned, prop as string, nonJson);
        }
      }
      store.set(prop as keyof InferSchema<S>, value as never);

      return true;
    },
    deleteProperty(_, prop) {
      if (reserved(prop)) {
        return false;
      }
      store.delete(prop as keyof InferSchema<S>);

      return true;
    },
    has(_, prop) {
      if (prop === "$store" || prop === "$snapshot") {
        return true;
      }
      if (typeof prop === "symbol" || BLOCKED_PROPS.has(prop)) {
        return false;
      }

      return store.has(prop as keyof InferSchema<S>);
    },
    ownKeys() {
      return Object.keys(schema);
    },
    getOwnPropertyDescriptor(_, prop) {
      if (typeof prop === "string" && BLOCKED_PROPS.has(prop)) {
        return undefined;
      }
      if (prop === "$store" || prop === "$snapshot") {
        return { configurable: true, enumerable: false, writable: false };
      }

      return { configurable: true, enumerable: true, writable: true };
    },
    defineProperty: () => false,
    getPrototypeOf: () => null,
    setPrototypeOf: () => false,
  });
}

export function createFacts<S extends Schema>(
  options: CreateFactsStoreOptions<S>,
): { store: FactsStore<S>; facts: Facts<S> } {
  const tracker = options.tracker ?? { deps: null };
  const store = createFactsStore({ ...options, tracker });

  return { store, facts: createFactsProxy(store, options.schema, tracker) };
}
