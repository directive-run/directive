/**
 * Turn anything an engine hands the recorder into plain, comparable JSON.
 *
 * Nothing nondeterministic is stripped here: the scenario runner makes the
 * sources of nondeterminism deterministic instead (fake timers fix
 * `Date.now`, `performance.now` and every timer at time 0; `Math.random` is
 * a seeded generator). What normalization does is make values that JSON
 * cannot hold, or that differ only by identity, comparable:
 *
 * - object keys are sorted, so key order never decides equality (Map and
 *   Set keep insertion order, which is observable);
 * - `undefined`, `NaN`, `±Infinity`, `-0` and bigints get tagged forms;
 * - an Error becomes `{ $error: { name, message, ...every own property } }`
 *   (a DirectiveError's source, sourceId, context, recoverable; `cause`,
 *   recursively) — never its stack, which names the file it was thrown
 *   from and so differs between engines;
 * - a function becomes `{ $fn: true }` — never its name, which a bundler
 *   may rename (`createSystem2`);
 * - Date, Map, Set, typed arrays and class instances get tagged forms;
 * - the system object (passed to the lifecycle hooks) becomes `"$system"`;
 * - a cycle becomes `{ $cycle: true }`; depth past 24 becomes `"$deep"`.
 */

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

const MAX_DEPTH = 24;

export interface NormalizeOptions {
  /** Objects to replace with a fixed marker (the system under test). */
  markers?: Map<object, string>;
}

/**
 * An error's name, message and every own property but `stack` — so a
 * DirectiveError's source, sourceId, context, recoverable and a `cause`
 * chain are all compared — walked like any other value (cycle-safe).
 */
function errorFields(
  error: Error,
  walk: (v: unknown) => Json,
): Record<string, Json> {
  const out: Record<string, Json> = {
    name: error.name,
    message: error.message,
  };
  for (const key of Object.getOwnPropertyNames(error).sort()) {
    if (key === "stack" || key === "name" || key === "message") {
      continue;
    }
    let value: unknown;
    try {
      value = (error as unknown as Record<string, unknown>)[key];
    } catch (thrown) {
      value = { $throws: String(thrown) };
    }
    out[key] = walk(value);
  }

  return out;
}

export function normalize(value: unknown, options: NormalizeOptions = {}) {
  const stack = new Set<object>();

  const walk = (v: unknown, depth: number): Json => {
    switch (typeof v) {
      case "undefined":
        return { $undefined: true };
      case "boolean":
      case "string":
        return v;
      case "number":
        if (Number.isNaN(v)) {
          return { $num: "NaN" };
        }
        if (!Number.isFinite(v)) {
          return { $num: v > 0 ? "Infinity" : "-Infinity" };
        }
        if (Object.is(v, -0)) {
          return { $num: "-0" };
        }

        return v;
      case "bigint":
        return { $bigint: v.toString() };
      case "symbol":
        return { $symbol: v.description ?? "" };
      case "function":
        return { $fn: true };
    }
    if (v === null) {
      return null;
    }
    const obj = v as object;
    const marker = options.markers?.get(obj);
    if (marker) {
      return marker;
    }
    if (stack.has(obj)) {
      return { $cycle: true };
    }
    if (depth > MAX_DEPTH) {
      return "$deep";
    }
    stack.add(obj);
    try {
      if (obj instanceof Error) {
        return { $error: errorFields(obj, (v) => walk(v, depth + 1)) };
      }
      if (obj instanceof Date) {
        return {
          $date: Number.isNaN(obj.getTime()) ? "invalid" : obj.toISOString(),
        };
      }
      if (obj instanceof Map) {
        return {
          $map: [...obj.entries()].map(([k, val]) => [
            walk(k, depth + 1),
            walk(val, depth + 1),
          ]),
        };
      }
      if (obj instanceof Set) {
        return { $set: [...obj].map((val) => walk(val, depth + 1)) };
      }
      if (ArrayBuffer.isView(obj)) {
        return {
          $typed: obj.constructor.name,
          values: Array.from(obj as unknown as ArrayLike<number>, (n) =>
            walk(n, depth + 1),
          ),
        };
      }
      if (Array.isArray(obj)) {
        return obj.map((item) => walk(item, depth + 1));
      }
      if (typeof AbortSignal !== "undefined" && obj instanceof AbortSignal) {
        return { $signal: { aborted: obj.aborted } };
      }
      const out: Record<string, Json> = {};
      const proto = Object.getPrototypeOf(obj);
      if (proto !== null && proto !== Object.prototype) {
        out.$class = (proto.constructor?.name as string | undefined) ?? "?";
      }
      for (const key of Object.keys(obj).sort()) {
        let item: unknown;
        try {
          item = (obj as Record<string, unknown>)[key];
        } catch (error) {
          item = { $throws: error };
        }
        out[key] = walk(item, depth + 1);
      }

      return out;
    } finally {
      stack.delete(obj);
    }
  };

  return walk(value, 0);
}
