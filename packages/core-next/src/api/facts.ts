/**
 * Facts: the 1.35 facts store and proxy, with every value held in a node of
 * the new reactive graph.
 *
 * A read inside a derivation is tracked by the graph itself (a node read
 * while a computed runs links to it). The store's own listener and batching
 * rules are the 1.35 ones, so subscribers see the same notifications in the
 * same order. Each store owns its graph unless one is passed in; nothing here
 * is module-level mutable state.
 *
 * Written for size (L0e): one keyed listener helper ({@link listen}) serves
 * every listener list here and in the system core, every notification goes
 * through one guarded loop, and development-only code sits behind the dev
 * flag so a production build drops it.
 */

import isDevelopment from "#is-development";
import { Graph, type ReactiveNode } from "../graph.js";
import type {
  FactChange,
  FactOrigin,
  Facts,
  FactsSnapshot,
  FactsStore,
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

/**
 * 1.35's isPrototypeSafe (utils.ts:291): no blocked key at any depth of a
 * loaded value, failing safe past depth 50. A value seen higher up the
 * current path (a cycle) is not walked again.
 */
export const isPrototypeSafe = (
  value: unknown,
  depth = 0,
  path = new WeakSet<object>(),
): boolean => {
  if (depth > 50) {
    return false;
  }
  if (value === null || typeof value !== "object" || path.has(value)) {
    return true;
  }
  path.add(value);
  for (const key of Object.keys(value)) {
    if (
      BLOCKED_PROPS.has(key) ||
      !isPrototypeSafe((value as Record<string, unknown>)[key], depth + 1, path)
    ) {
      return false;
    }
  }
  path.delete(value);

  return true;
};

/** Per-system tracking: what the running derivation or effect read. */
export interface Tracker {
  /** Fact keys and `\u001F`-prefixed derivation ids read in this frame. */
  deps: Set<string> | null;
  /**
   * The frame of the effect body running now (quirk c): while `deps` is this
   * set, a membership test on the derived view records {@link MEMBER_DEP_PREFIX}
   * + the name instead of the derivation's value key. Set only by the effects
   * part, so a system without effects never reads anything but `undefined`.
   */
  effect_?: Set<string>;
}

/**
 * Who made a write: a small integer passed with it (`store.set(key, value,
 * stamp)`). 0 is unattributed (an event, init, a listener, the user); a
 * resolver run passes its run id. Never held in an ambient variable, so a
 * listener's nested write is never credited to the write that woke it.
 */
export type Stamp = number;

/**
 * Where the store reports each write that changed something, with its
 * stamp. A holder, like {@link Tracker}: the reconcile part fills it in
 * after the store exists; while it is null a write costs one check.
 */
export interface Writers {
  record: ((key: string, stamp: Stamp) => void) | null;
}

/**
 * RFC-0003 binding: asked before a run's write to `key` lands (a delete
 * passes `undefined` and `deleting`); false drops it (a clobber).
 */
export type Allow = (key: string, value: unknown, deleting?: true) => boolean;

/** A facts view whose writes carry one stamp (a resolver run). */
export interface Writer {
  readonly stamp_: Stamp;
  /** Superseded: a newer run owns the requirement, its writes are dropped. */
  readonly dropped_: boolean;
}

export const DERIVATION_DEP_PREFIX = "\u001F";
/**
 * Quirk (c) and (w): what an effect's `"name" in derived` depends on, whether
 * the answer was true or false. Nothing changes membership before L10, whose
 * register/unregister of a derivation adds this key to the changed set.
 */
export const MEMBER_DEP_PREFIX = "\u001E";
export const describeDep = (dep: string): string =>
  dep.startsWith(DERIVATION_DEP_PREFIX) ? `derive.${dep.slice(1)}` : dep;

/** Run `fn` with `deps` as the tracker's frame; restore the previous one. */
const framed = <T>(tracker: Tracker, deps: Set<string> | null, fn: () => T) => {
  const prev = tracker.deps;
  tracker.deps = deps;
  try {
    return fn();
  } finally {
    tracker.deps = prev;
  }
};

export function withTracking<T>(
  tracker: Tracker,
  fn: () => T,
): { value: T; deps: Set<string> } {
  const deps = new Set<string>();

  return { value: framed(tracker, deps, fn), deps };
}

export const withoutTracking = <T>(tracker: Tracker, fn: () => T): T =>
  framed(tracker, null, fn);

/** Keyed listener lists, as every store and system keeps them. */
export type Listeners<K = string> = Map<K, Set<() => void>>;

/**
 * Add `fn` under each of `keys`; returns the remover. The one listener
 * pattern of the store and the system core (fact keys, the store's
 * catch-all, derivation ids).
 */
export function listen<K>(
  map: Listeners<K>,
  keys: readonly K[],
  fn: () => void,
): () => void {
  for (const key of keys) {
    let set = map.get(key);
    if (!set) {
      map.set(key, (set = new Set()));
    }
    set.add(fn);
  }

  return () => {
    for (const key of keys) {
      const set = map.get(key);
      // An emptied set goes, so a listener added during a notify starts a
      // fresh set and waits for the next write, as in 1.35.
      if (set?.delete(fn) && !set.size) {
        map.delete(key);
      }
    }
  };
}

/** Call every listener under `key`, live (added ones run, removed ones not). */
export const notify = <K>(map: Listeners<K>, key: K): void =>
  map.get(key)?.forEach((fn) => fn());

const no = () => false;
/** The traps a locked view shares: no new properties, no prototype. */
export const LOCKED = {
  defineProperty: no,
  getPrototypeOf: () => null,
  setPrototypeOf: no,
};

/**
 * A read-only keyed view (the system's `derive` and `events`): `has` says
 * which keys exist, `get` reads one. `traps` adds or overrides traps.
 */
export function view(
  has: (key: string) => boolean,
  keys: () => string[],
  get: (key: string) => unknown,
  traps?: ProxyHandler<Record<string, unknown>>,
): Record<string, unknown> {
  const own = (_: object, key: string | symbol) =>
    typeof key === "string" && has(key);

  return new Proxy({} as Record<string, unknown>, {
    get: (_, key) => (own(_, key) ? get(key as string) : undefined),
    has: own,
    ownKeys: keys,
    getOwnPropertyDescriptor: (_, key) =>
      own(_, key)
        ? { configurable: true, enumerable: true, writable: false }
        : undefined,
    ...traps,
  });
}

export interface CreateFactsStoreOptions<S extends Schema> {
  schema: S;
  /**
   * Checks a write (development only). Built by `createValidator`
   * (validate.ts), so a store without one never bundles validation.
   */
  validator?: (key: string, value: unknown) => void;
  /** `by`: the write's stamp (0 when unattributed). */
  onChange?: (key: string, value: unknown, prev: unknown, by: Stamp) => void;
  /** `by`: the stamp every change shares, else 0. */
  onBatch?: (changes: FactChange[], by: Stamp) => void;
  onWrite?: (key: string) => void;
  onBatchStart?: () => void;
  onBatchEnd?: () => void;
  originOf?: () => FactOrigin;
  /** The graph to hold values in (a system passes its own). */
  graph?: Graph;
  tracker?: Tracker;
  /** Told of each write that changed something, with its stamp. */
  writers?: Writers;
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

/** The key the store's catch-all (`subscribeAll`) listeners sit under. */
const ALL = Symbol();

export function createFactsStore<S extends Schema>(
  options: CreateFactsStoreOptions<S>,
): FactsStore<S> {
  const { onChange, onBatch, onWrite, onBatchStart, onBatchEnd, validator } =
    options;
  const originOf = options.originOf ?? (() => "authored" as FactOrigin);
  const graph = options.graph ?? new Graph();
  const tracker = options.tracker ?? { deps: null };
  const writers: Writers = options.writers ?? { record: null };

  /** One graph node per key; `present` says whether the key holds a value. */
  const nodes = options.nodes ?? new Map<string, ReactiveNode>();
  const present = new Set<string>();
  const listeners: Listeners<string | typeof ALL> = new Map();
  let batching = 0;
  const changes: FactChange[] = [];
  const dirty = new Set<string>();
  let notifying = false;
  /** Writes made while notifying: [key, value, prev, stamp]. */
  const pending: [string, unknown, unknown, Stamp][] = [];
  /** The open batch's shared stamp: -1 before its first write, 0 if mixed. */
  let batchBy = -1;

  const node = (key: string): ReactiveNode => {
    let n = nodes.get(key);
    if (!n) {
      nodes.set(key, (n = graph.signal<unknown>(undefined, { equals: false })));
    }

    return n;
  };
  const read = (key: string): unknown => {
    tracker.deps?.add(key);

    return graph.read(node(key));
  };

  /**
   * Notify: the first write (`key`, with `onChange`) or the flushed `keys`
   * run, then every write the listeners made, a round at a time, until none
   * is left (100 rounds at most). Arguments, not a closure: a write outside a
   * batch allocates nothing here.
   */
  function run(
    context: string,
    keys: string[] | null,
    key?: string,
    value?: unknown,
    prev?: unknown,
    by: Stamp = 0,
  ): void {
    notifying = true;
    try {
      if (keys) {
        for (const k of keys) {
          notify(listeners, k);
        }
      } else {
        onChange?.(key!, value, prev, by);
        notify(listeners, key!);
      }
      notify(listeners, ALL);
      for (let rounds = 0; pending.length > 0; ) {
        if (++rounds > 100) {
          pending.length = 0;
          throw Object.assign(
            Error(
              `[Directive] Infinite notification loop detected after 100 iterations${context}.`,
            ),
            { [RUNAWAY]: true },
          );
        }
        for (const [key, value, prev, stamp] of pending.splice(0)) {
          onChange?.(key, value, prev, stamp);
          notify(listeners, key);
        }
        notify(listeners, ALL);
      }
    } finally {
      notifying = false;
    }
  }

  function record(
    key: string,
    value: unknown,
    prev: unknown,
    type: "set" | "delete",
    stamp: Stamp,
  ): void {
    if (batching > 0) {
      changes.push({ key, value, prev, type, origin: originOf() });
      dirty.add(key);
      batchBy = batchBy < 0 || batchBy === stamp ? stamp : 0;
      onWrite?.(key);
    } else if (notifying) {
      pending.push([key, value, prev, stamp]);
    } else {
      run(
        ". A listener is repeatedly mutating facts that re-trigger notifications",
        null,
        key,
        value,
        prev,
        stamp,
      );
    }
  }

  function flush(): void {
    // A batch that wrote nothing (an effect run, say) has nothing to flush:
    // return before building the lists.
    if (batching > 0 || !dirty.size) {
      return;
    }
    const batch = changes.splice(0);
    const keys = [...dirty];
    const by = batchBy < 0 ? 0 : batchBy;
    dirty.clear();
    batchBy = -1;
    if (onBatch) {
      onBatch(batch, by);
    }
    run(" during flush", keys);
  }

  const store = {
    get: read,
    has(key: string) {
      read(key);

      return present.has(key);
    },
    set(key: string, value: unknown, stamp: Stamp = 0) {
      if (isDevelopment) {
        validator?.(key, value);
      }
      const n = node(key);
      const prev = n.value;
      if (!Object.is(prev, value)) {
        present.add(key);
        graph.write(n, value);
        writers.record?.(key, stamp);
        record(key, value, prev, "set", stamp);
      }
    },
    delete(key: string, stamp: Stamp = 0) {
      const n = node(key);
      const prev = n.value;
      const had = present.delete(key);
      // Deleting an absent key changes nothing its writer can claim.
      writers.record?.(key, had ? stamp : 0);
      graph.write(n, undefined);
      record(key, undefined, prev, "delete", had ? stamp : 0);
    },
    batch(fn: () => void) {
      const outermost = !batching++;
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
    subscribe: (keys: string[], fn: () => void) => listen(listeners, keys, fn),
    subscribeAll: (fn: () => void) => listen(listeners, [ALL], fn),
    toObject() {
      const out: Record<string, unknown> = {};
      for (const key of present) {
        out[key] = nodes.get(key)!.value;
      }

      return out;
    },
    destroy() {
      listeners.clear();
    },
  };

  return store as unknown as FactsStore<S>;
}

export const DEV_PROXY_TARGET = Symbol.for("directive.devProxyTarget");
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

/** Development only: a nested value that warns on in-place mutation. */
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
      if (
        proto !== Object.prototype &&
        proto !== null &&
        !Array.isArray(value)
      ) {
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
  writer?: Writer,
  allow?: Allow,
): Facts<S> {
  const stamp = writer ? writer.stamp_ : 0;
  const nested = new WeakMap<object, object>();
  const s = store as unknown as FactsStore;
  const untracked =
    <T>(fn: () => T) =>
    () =>
      withoutTracking(tracker, fn);
  const snapshot = (): FactsSnapshot<S> => ({
    get: (key) => untracked(() => store.get(key))(),
    has: (key) => untracked(() => store.has(key))(),
  });
  const special = (prop: string | symbol) =>
    prop === "$store" || prop === "$snapshot";
  const reserved = (prop: string | symbol): prop is symbol =>
    typeof prop === "symbol" || special(prop) || BLOCKED_PROPS.has(prop);

  return new Proxy({} as Facts<S>, {
    get(_, prop) {
      if (typeof prop === "symbol") {
        return prop === INSPECT ? untracked(s.toObject) : undefined;
      }
      if (BLOCKED_PROPS.has(prop)) {
        return undefined;
      }
      if (special(prop)) {
        return prop === "$store" ? store : snapshot;
      }
      const value = s.get(prop);
      if (
        isDevelopment &&
        value !== null &&
        typeof value === "object" &&
        (value as Record<symbol, unknown>)[DEV_PROXY_TARGET] === undefined
      ) {
        return wrapNested(nested, value, prop);
      }

      return value;
    },
    set(_, prop, value) {
      if (writer?.dropped_) {
        return true;
      }
      if (reserved(prop)) {
        return false;
      }
      if (allow && !allow(prop, value)) {
        // Dropped, not refused: a strict-mode body does not throw.
        return true;
      }
      if (isDevelopment) {
        const nonJson = detectNonJsonValueType(value);
        if (nonJson) {
          // A module's fact by its module-qualified name, `ns.key` (o).
          warnNonJson(warned, prop.replace("::", "."), nonJson);
        }
      }
      s.set(prop, value, stamp);

      return true;
    },
    deleteProperty(_, prop) {
      if (writer?.dropped_) {
        return true;
      }
      if (reserved(prop)) {
        return false;
      }
      if (allow && !allow(prop, undefined, true)) {
        return true;
      }
      s.delete(prop, stamp);

      return true;
    },
    has: (_, prop) =>
      special(prop) || (!reserved(prop) && s.has(prop as string)),
    ownKeys: () => Object.keys(schema),
    getOwnPropertyDescriptor: (_, prop) =>
      typeof prop === "string" && BLOCKED_PROPS.has(prop)
        ? undefined
        : {
            configurable: true,
            enumerable: !special(prop),
            writable: !special(prop),
          },
    ...LOCKED,
  });
}

export function createFacts<S extends Schema>(
  options: CreateFactsStoreOptions<S>,
): { store: FactsStore<S>; facts: Facts<S> } {
  const tracker = options.tracker ?? { deps: null };
  const store = createFactsStore({ ...options, tracker });

  return { store, facts: createFactsProxy(store, options.schema, tracker) };
}
