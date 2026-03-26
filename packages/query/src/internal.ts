/**
 * Shared internal utilities for @directive-run/query.
 *
 * @internal Not part of the public API.
 * @module
 */

/** Prefix for all internal query fact keys. Reserved — user facts must not start with `_q_`. */
export const PREFIX = "_q_";

/** Build a prefixed internal fact key. */
export function buildKey(name: string, suffix: string): string {
  return `${PREFIX}${name}_${suffix}`;
}

/**
 * Serialize a key object to a stable string for cache identity.
 * Sorts keys to ensure `{a:1, b:2}` and `{b:2, a:1}` produce the same string.
 * Uses `Object.create(null)` to prevent prototype pollution.
 */
export function serializeKey(key: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(key)
      .sort()
      .reduce(
        (acc, k) => {
          acc[k] = key[k];

          return acc;
        },
        Object.create(null) as Record<string, unknown>,
      ),
  );
}

/**
 * Deep equal with reference preservation. Returns the old reference if deeply equal,
 * preventing unnecessary re-renders in framework adapters.
 *
 * Only processes plain objects and arrays. Non-plain objects (Date, RegExp, Map, Set,
 * class instances) are always replaced with the new value.
 */
export function replaceEqualDeep(oldVal: unknown, newVal: unknown): unknown {
  if (Object.is(oldVal, newVal)) {
    return oldVal;
  }

  if (
    typeof oldVal !== "object" ||
    typeof newVal !== "object" ||
    oldVal === null ||
    newVal === null
  ) {
    return newVal;
  }

  // Non-plain objects (Date, RegExp, Map, Set, etc.) — always use new value
  const oldProto = Object.getPrototypeOf(oldVal);
  const newProto = Object.getPrototypeOf(newVal);
  if (
    (oldProto !== Object.prototype &&
      oldProto !== null &&
      !Array.isArray(oldVal)) ||
    (newProto !== Object.prototype &&
      newProto !== null &&
      !Array.isArray(newVal))
  ) {
    return newVal;
  }

  const oldArr = Array.isArray(oldVal);
  const newArr = Array.isArray(newVal);
  if (oldArr !== newArr) {
    return newVal;
  }

  if (oldArr && newArr) {
    const oldA = oldVal as unknown[];
    const newA = newVal as unknown[];
    if (oldA.length !== newA.length) {
      return newVal;
    }
    let same = true;
    const result = new Array(newA.length);
    for (let i = 0; i < newA.length; i++) {
      result[i] = replaceEqualDeep(oldA[i], newA[i]);
      if (result[i] !== oldA[i]) {
        same = false;
      }
    }

    return same ? oldVal : result;
  }

  const oldObj = oldVal as Record<string, unknown>;
  const newObj = newVal as Record<string, unknown>;
  const oldKeys = Object.keys(oldObj);
  const newKeys = Object.keys(newObj);
  if (oldKeys.length !== newKeys.length) {
    return newVal;
  }

  let same = true;
  const result: Record<string, unknown> = {};
  for (const k of newKeys) {
    if (!(k in oldObj)) {
      return newVal;
    }
    result[k] = replaceEqualDeep(oldObj[k], newObj[k]);
    if (result[k] !== oldObj[k]) {
      same = false;
    }
  }

  return same ? oldVal : result;
}
