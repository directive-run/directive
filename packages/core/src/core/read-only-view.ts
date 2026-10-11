/**
 * Read-only views over facts for code that must not change them.
 *
 * Effects use these today. Dependency views and source gates are meant to use
 * the same helper, so the rule and its error read the same everywhere.
 *
 * Not exported from any public entry point.
 *
 * @internal
 * @module
 */

import isDevelopment from "#is-development";
import { DEV_PROXY_TARGET } from "./facts.js";
export type { DeepReadonly } from "./types/facts.js";

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

/** Plain objects and arrays: the values that can be mutated in place. */
function isPlainContainer(value: unknown): value is object {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/** The first path at which `before` and `after` differ, or `null`. */
function firstDifference(
  before: unknown,
  after: unknown,
  path: string,
  seen: WeakSet<object>,
): string | null {
  if (Object.is(before, after)) {
    return null;
  }
  if (
    before === null ||
    after === null ||
    typeof before !== "object" ||
    typeof after !== "object"
  ) {
    return path;
  }
  if (seen.has(after)) {
    return null;
  }
  seen.add(after);
  if (Array.isArray(before) !== Array.isArray(after)) {
    return path;
  }
  if (!isPlainContainer(after)) {
    // A Date, Map or Set cannot be compared through its properties. A clone of
    // one is never identical, so only a change of type is reported.
    return Object.getPrototypeOf(before) === Object.getPrototypeOf(after)
      ? null
      : path;
  }
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  if (beforeKeys.length !== afterKeys.length) {
    const added = afterKeys.find((key) => !(key in before));
    const removed = beforeKeys.find((key) => !(key in after));

    return `${path}.${added ?? removed ?? ""}`;
  }
  for (const key of afterKeys) {
    const difference = firstDifference(
      (before as Record<string, unknown>)[key],
      (after as Record<string, unknown>)[key],
      `${path}.${key}`,
      seen,
    );
    if (difference !== null) {
      return difference;
    }
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
 * development checks for it instead. The first read of each plain object or
 * array records a structural copy; {@link CheckedReadView.takeMutation}
 * compares it with the stored value and names the first path that changed.
 * Production records nothing.
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
  const recorded = isDevelopment
    ? new Map<string, { value: object; copy: unknown; extensible: boolean }>()
    : null;

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
        isPlainContainer(value) &&
        !recorded.has(prop)
      ) {
        try {
          recorded.set(prop, {
            value,
            copy: structuredClone(value),
            extensible: Object.isExtensible(value),
          });
        } catch {
          // Holds something that cannot be copied; it is not checked.
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
      for (const [name, { value, copy, extensible }] of recorded) {
        const key = options.prefix ? `${options.prefix}.${name}` : name;
        // `Object.freeze` or `preventExtensions` on a stored value changes
        // nothing structural, but it is still a change to the fact.
        if (extensible && !Object.isExtensible(value)) {
          found = `${key} (frozen)`;
          break;
        }
        found = firstDifference(copy, value, key, new WeakSet());
        if (found !== null) {
          break;
        }
      }
      recorded.clear();

      return found;
    },
  };
}
