/**
 * Read-only views over facts for code that must not change them.
 *
 * Effects, a resolver's view of its dependency modules, and source gates all
 * read through this helper, so the rule and its check are the same everywhere.
 *
 * Not exported from any public entry point.
 *
 * @internal
 * @module
 */

import isDevelopment from "#is-development";
import { DEV_PROXY_TARGET } from "./facts.js";

/** Called for a refused top-level write. Returns `true` when it does not throw. */
export type RefuseWrite = (key: string) => true;

/** A view plus the check that reports what was mutated through it. */
export interface CheckedReadView<T extends object> {
  /** The object to hand out. */
  view: T;
  /**
   * The dotted path of the first nested value that was mutated in place since
   * the last call, or `null`. Development only: production never records reads
   * and always answers `null`.
   */
  takeMutation(): string | null;
}

/** The value a development warning wrapper stands in front of, or the value. */
function unwrap(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  return (value as { [DEV_PROXY_TARGET]?: object })[DEV_PROXY_TARGET] ?? value;
}

/**
 * The most slots one check records before it gives up. A value bigger than
 * this – a cached list of thousands of rows – is left unchecked rather than
 * walked on every read, so development stays fast with large data.
 */
const NODE_BUDGET = 2000;

/** One recorded container: the object itself and what its slots held. */
interface Snapshot {
  readonly ref: object;
  readonly prototype: object | null;
  readonly extensible: boolean;
  /** Date only: the time it held. */
  readonly time?: number;
  /**
   * Own data properties (objects, arrays, class instances), entries (Map) or
   * values (Set), in order, each with the snapshot of the object it held, if
   * that was recorded.
   */
  readonly slots: Array<{
    readonly key: unknown;
    readonly value: unknown;
    readonly child: Snapshot | null;
  }>;
  readonly kind: "object" | "map" | "set" | "date";
}

/** Counts recorded slots against {@link NODE_BUDGET}. */
interface Budget {
  left: number;
}

/** Values recorded slot by slot. Functions, typed arrays and the like are leaves. */
function isRecordable(value: unknown): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !ArrayBuffer.isView(value) &&
    !(value instanceof ArrayBuffer) &&
    !(value instanceof Promise) &&
    !(value instanceof WeakMap) &&
    !(value instanceof WeakSet)
  );
}

/**
 * Record `value` by reference, without copying it and without running any
 * getter: own properties are read through their descriptors, and an accessor
 * is recorded as its getter and setter functions. Returns `null` once the
 * budget runs out, which leaves the whole value unchecked.
 */
function record(
  value: object,
  budget: Budget,
  seen: WeakSet<object>,
): Snapshot | null {
  seen.add(value);
  const slots: Array<{ key: unknown; value: unknown; child: Snapshot | null }> =
    [];
  const base = {
    ref: value,
    prototype: Object.getPrototypeOf(value) as object | null,
    extensible: Object.isExtensible(value),
  };
  const child = (held: unknown): Snapshot | null | undefined => {
    if (!isRecordable(held) || seen.has(held)) {
      return null;
    }
    const recorded = record(held, budget, seen);

    // `undefined` means the budget ran out below.
    return recorded ?? undefined;
  };
  const push = (key: unknown, held: unknown): boolean => {
    budget.left--;
    if (budget.left < 0) {
      return false;
    }
    const nested = child(held);
    if (nested === undefined) {
      return false;
    }
    slots.push({ key, value: held, child: nested });

    return true;
  };

  if (value instanceof Date) {
    budget.left--;

    return budget.left < 0
      ? null
      : { ...base, kind: "date", time: value.getTime(), slots };
  }
  if (value instanceof Map) {
    for (const [key, held] of value) {
      if (!push(key, held)) {
        return null;
      }
    }

    return { ...base, kind: "map", slots };
  }
  if (value instanceof Set) {
    for (const held of value) {
      if (!push(held, undefined)) {
        return null;
      }
    }

    return { ...base, kind: "set", slots };
  }
  // Give up before listing the keys of an array the budget cannot cover:
  // listing them is itself a walk of the whole array.
  if (Array.isArray(value) && value.length >= budget.left) {
    budget.left = -1;

    return null;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    const held =
      "value" in descriptor
        ? descriptor.value
        : { get: descriptor.get, set: descriptor.set };
    if ("value" in descriptor) {
      if (!push(key, held)) {
        return null;
      }
    } else {
      budget.left--;
      if (budget.left < 0) {
        return null;
      }
      slots.push({ key, value: descriptor.get ?? descriptor.set, child: null });
    }
  }

  return { ...base, kind: "object", slots };
}

/** Describe a slot for a reported path. */
function slotPath(
  snapshot: Snapshot,
  path: string,
  key: unknown,
  index: number,
) {
  if (snapshot.kind === "object") {
    return `${path}.${String(key)}`;
  }
  if (snapshot.kind === "map") {
    return typeof key === "string" || typeof key === "number"
      ? `${path}.get(${JSON.stringify(key)})`
      : `${path}[${index}].value`;
  }

  return `${path}[${index}]`;
}

/** The current value a recorded object slot holds, read without getters. */
function currentObjectSlot(
  ref: object,
  key: string,
): { present: boolean; value: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(ref, key);
  if (descriptor === undefined) {
    return { present: false, value: undefined };
  }

  return {
    present: true,
    value:
      "value" in descriptor
        ? descriptor.value
        : (descriptor.get ?? descriptor.set),
  };
}

/** The first path at which the recorded object no longer matches, or `null`. */
function firstChange(snapshot: Snapshot, path: string): string | null {
  const { ref } = snapshot;
  if (Object.getPrototypeOf(ref) !== snapshot.prototype) {
    return `${path} (prototype)`;
  }
  if (snapshot.extensible && !Object.isExtensible(ref)) {
    return `${path} (frozen)`;
  }
  if (snapshot.kind === "date") {
    return (ref as Date).getTime() === snapshot.time ? null : path;
  }
  if (snapshot.kind === "map" || snapshot.kind === "set") {
    const collection = ref as Map<unknown, unknown> | Set<unknown>;
    if (collection.size !== snapshot.slots.length) {
      return `${path} (size ${snapshot.slots.length} → ${collection.size})`;
    }
    let index = 0;
    for (const entry of collection) {
      const recorded = snapshot.slots[index]!;
      const [key, value] =
        snapshot.kind === "map"
          ? (entry as [unknown, unknown])
          : [entry, undefined];
      if (!Object.is(key, recorded.key)) {
        return `${path}[${index}]`;
      }
      if (!Object.is(value, recorded.value)) {
        return slotPath(snapshot, path, key, index);
      }
      index++;
    }
  } else {
    const keys = Object.getOwnPropertyNames(ref);
    if (keys.length !== snapshot.slots.length) {
      const before = new Set(snapshot.slots.map((slot) => slot.key));
      const added = keys.find((key) => !before.has(key));
      const removed = snapshot.slots.find(
        (slot) =>
          !Object.prototype.hasOwnProperty.call(ref, slot.key as string),
      );

      return `${path}.${added ?? String(removed?.key ?? "")}`;
    }
    for (const slot of snapshot.slots) {
      const current = currentObjectSlot(ref, slot.key as string);
      if (!current.present || !Object.is(current.value, slot.value)) {
        return `${path}.${String(slot.key)}`;
      }
    }
  }
  let index = 0;
  for (const slot of snapshot.slots) {
    if (slot.child !== null) {
      const nested = firstChange(
        slot.child,
        slotPath(snapshot, path, slot.key, index),
      );
      if (nested !== null) {
        return nested;
      }
    }
    index++;
  }

  return null;
}

/**
 * A read-only view of `source` that hands out the real stored values.
 *
 * Top-level writes, deletes and property definitions are refused through
 * `refuse`. Nested values are returned as they are stored, not wrapped, so the
 * view behaves the same in development and production for code that only
 * reads: `structuredClone`, `postMessage`, identity checks and
 * `Object.isFrozen` all see the stored value.
 *
 * A nested value cannot be stopped from being mutated without wrapping it, so
 * development checks for it instead. The first read of each object records it
 * by reference: every own data property's value, every Map and Set entry, a
 * Date's time, and the same one level down, recursively. Nothing is copied
 * and no getter runs, so class instances, lazy getters and values that cannot
 * be cloned are all fine. {@link CheckedReadView.takeMutation} then names the
 * first slot that holds something else. A value bigger than the budget is
 * left unchecked. Production records nothing.
 *
 * Reads forward to `source`, so a tracking proxy still records them.
 */
export function createCheckedReadView<T extends object>(
  source: T,
  refuse: RefuseWrite,
  options: {
    /** Values a key maps to instead of the source's, e.g. a read-only store. */
    override?: (key: string | symbol) => unknown;
    /** Prepended to reported paths, e.g. `"prevFacts"`. */
    prefix?: string;
  } = {},
): CheckedReadView<T> {
  const target = source as unknown as Record<string | symbol, unknown>;
  const recorded = isDevelopment ? new Map<string, Snapshot | null>() : null;
  let budget: Budget = { left: NODE_BUDGET };

  const view = new Proxy(Object.create(null) as T, {
    get(_, prop) {
      if (options.override) {
        const replaced = options.override(prop);
        if (replaced !== undefined) {
          return replaced;
        }
      }
      const value = unwrap(target[prop]);
      if (
        recorded !== null &&
        typeof prop === "string" &&
        isRecordable(value) &&
        !recorded.has(prop)
      ) {
        recorded.set(prop, record(value, budget, new WeakSet()));
      }

      return value;
    },
    set(_, prop) {
      return refuse(String(prop));
    },
    deleteProperty(_, prop) {
      return refuse(String(prop));
    },
    defineProperty(_, prop) {
      return refuse(String(prop));
    },
    preventExtensions() {
      refuse("(preventExtensions)");

      return false;
    },
    setPrototypeOf() {
      refuse("(setPrototypeOf)");

      return false;
    },
    has(_, prop) {
      return prop in target;
    },
    ownKeys() {
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
      if (descriptor === undefined) {
        return undefined;
      }

      // Reported configurable, because the view's own target has no such
      // property and a proxy may not claim a non-configurable one it lacks.
      return { ...descriptor, configurable: true };
    },
    getPrototypeOf() {
      return null;
    },
    isExtensible() {
      return true;
    },
  });

  return {
    view,
    takeMutation(): string | null {
      if (recorded === null || recorded.size === 0) {
        return null;
      }
      let found: string | null = null;
      for (const [name, snapshot] of recorded) {
        if (snapshot === null) {
          continue;
        }
        found = firstChange(
          snapshot,
          options.prefix ? `${options.prefix}.${name}` : name,
        );
        if (found !== null) {
          break;
        }
      }
      recorded.clear();
      budget = { left: NODE_BUDGET };

      return found;
    },
  };
}
