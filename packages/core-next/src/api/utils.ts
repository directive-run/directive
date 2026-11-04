/**
 * 1.35's small public utilities (utils/utils.ts, index.ts), with 1.35's
 * names, signatures and results. Nothing in the engine calls them, so a
 * system that does not import them bundles none of this.
 */

import { BLOCKED_PROPS } from "./facts.js";

/**
 * Backoff strategy constants for retry policies (1.35's index.ts).
 *
 * @example
 * ```ts
 * retry: { attempts: 3, backoff: Backoff.Exponential, initialDelay: 100 }
 * ```
 */
export const Backoff = {
  /** No delay between retries */
  None: "none",
  /** Linear delay increase (initialDelay * attempt) */
  Linear: "linear",
  /** Exponential delay increase (initialDelay * 2^attempt) */
  Exponential: "exponential",
} as const;

/** 1.35's shallowEqual: same own keys, each value `===`. */
export function shallowEqual<T extends Record<string, unknown>>(
  a: T,
  b: T,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) {
    return false;
  }
  for (const key of keysA) {
    if (a[key] !== b[key]) {
      return false;
    }
  }

  return true;
}

/**
 * 1.35's isPrototypeSafe (utils.ts:291): true when no `__proto__`,
 * `constructor` or `prototype` key appears at any depth. Past `maxDepth` it
 * fails safe (false); a value already on the current path (a cycle) counts
 * as safe. An array is walked by its elements only, as in 1.35.
 *
 * The engine's own check (facts.ts) is stricter on arrays (it also checks an
 * array's own named keys) and keeps its fixed depth; this one is 1.35's.
 */
export function isPrototypeSafe(obj: unknown, maxDepth = 50): boolean {
  const seen = new WeakSet<object>();
  const check = (value: unknown, depth: number): boolean => {
    if (depth > maxDepth) {
      return false;
    }
    if (value === null || typeof value !== "object") {
      return true;
    }
    if (seen.has(value)) {
      return true;
    }
    seen.add(value);
    let safe = true;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!check(item, depth + 1)) {
          safe = false;
          break;
        }
      }
    } else {
      for (const key of Object.keys(value)) {
        if (
          BLOCKED_PROPS.has(key) ||
          !check((value as Record<string, unknown>)[key], depth + 1)
        ) {
          safe = false;
          break;
        }
      }
    }
    seen.delete(value);

    return safe;
  };

  return check(obj, 0);
}
