/**
 * The read-only view an effect sees its facts, prev and derived through (the
 * 1.35 `createCheckedReadView`, carried over unchanged in behaviour).
 *
 * Every write, delete, define, freeze or prototype change is refused through
 * `refuse`. In development each top-level value read is also recorded, and
 * `takeMutation()` names the first path the effect changed in place since the
 * last check (bounded by a node budget, so a huge value is skipped, not
 * walked forever). Production keeps only the refusing view.
 */

import isDevelopment from "#is-development";
import { DEV_PROXY_TARGET } from "./facts.js";

export type RefuseWrite = (key: string) => true;

export interface CheckedReadView<T extends object> {
  view: T;
  /** The first path changed in place since the last call, or null. */
  takeMutation(): string | null;
}

function unwrap(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  return (value as { [DEV_PROXY_TARGET]?: object })[DEV_PROXY_TARGET] ?? value;
}

const NODE_BUDGET = 2000;

interface Snapshot {
  readonly ref: object;
  readonly prototype: object | null;
  readonly extensible: boolean;
  readonly time?: number;
  readonly slots: Array<{
    readonly key: unknown;
    readonly value: unknown;
    readonly child: Snapshot | null;
  }>;
  readonly kind: "object" | "map" | "set" | "date";
}

interface Budget {
  left: number;
}

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

export function createCheckedReadView<T extends object>(
  source: T,
  refuse: RefuseWrite,
  options: {
    override?: (key: string | symbol) => unknown;
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
      if (isDevelopment) {
        if (
          recorded !== null &&
          typeof prop === "string" &&
          isRecordable(value) &&
          !recorded.has(prop)
        ) {
          recorded.set(prop, record(value, budget, new WeakSet()));
        }
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
      let found: string | null = null;
      // A positive dev block, so a production build drops the whole check.
      if (isDevelopment) {
        if (recorded !== null && recorded.size > 0) {
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
        }
      }

      return found;
    },
  };
}
