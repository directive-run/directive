/**
 * Dependency tracking context for auto-tracking derivations
 *
 * Uses a stack-based approach to handle nested derivation computations.
 * When a derivation accesses a fact, the tracking context records it.
 */

/** Stack of active dependency sets (bare Sets for zero-allocation hot path) */
const depStack: Set<string>[] = [];

/**
 * Get the current dependency set, or null if not tracking.
 *
 * @returns The active dependency Set, or `null` if no tracking is active.
 *
 * @internal
 */
export function getCurrentDeps(): Set<string> | null {
  const len = depStack.length;
  return len === 0 ? null : depStack[len - 1]!;
}

/**
 * Check if dependency tracking is currently active.
 *
 * @returns `true` if inside a {@link withTracking} call, `false` otherwise.
 *
 * @internal
 */
export function isTracking(): boolean {
  return depStack.length > 0;
}

/**
 * Run a function with dependency tracking.
 *
 * @remarks
 * Pushes a fresh Set onto the stack, executes `fn`, then pops it.
 * Any fact reads inside `fn` are recorded as dependencies.
 * Nesting is supported — inner calls get their own independent Set.
 *
 * @param fn - The function to execute under tracking.
 * @returns An object with the computed `value` and a `deps` Set of accessed
 *   fact keys.
 *
 * @internal
 */
export function withTracking<T>(fn: () => T): { value: T; deps: Set<string> } {
  const deps = new Set<string>();
  depStack.push(deps);

  try {
    const value = fn();
    return { value, deps };
  } finally {
    depStack.pop();
  }
}

/**
 * Run a function without tracking.
 *
 * @remarks
 * Temporarily clears the tracking stack so that fact reads inside `fn` do
 * not register as dependencies. The stack is restored after `fn` returns
 * (even on error). Useful for side-effect reads that should not trigger
 * derivation invalidation.
 *
 * @param fn - The function to execute without tracking.
 * @returns The return value of `fn`.
 *
 * @internal
 */
export function withoutTracking<T>(fn: () => T): T {
  const saved = depStack.splice(0, depStack.length);

  try {
    return fn();
  } finally {
    for (const ctx of saved) {
      depStack.push(ctx);
    }
  }
}

/**
 * Track a specific key in the current context.
 *
 * @remarks
 * No-op if no tracking context is active.
 *
 * @param key - The fact key to record as a dependency.
 *
 * @internal
 */
export function trackAccess(key: string): void {
  const len = depStack.length;
  if (len === 0) {
    return;
  }
  depStack[len - 1]!.add(key);
}

/**
 * Prototype pollution guard — shared across all proxy handlers.
 *
 * @remarks
 * Contains `__proto__`, `constructor`, and `prototype`. Every proxy `get`
 * and `has` trap checks this set and returns `undefined` / `false` for
 * matching keys, preventing prototype pollution via proxy-based objects.
 *
 * @internal
 */
export const BLOCKED_PROPS: ReadonlySet<string> = Object.freeze(
  new Set(["__proto__", "constructor", "prototype"]),
);

// ============================================================================
// Non-JSON value-type detection (MIGRATION_FEEDBACK item 20)
// ============================================================================

/**
 * Detect whether `value` is a non-JSON-roundtrippable type whose mutations
 * the facts proxy cannot track for reactivity.
 *
 * Returns the kind label (`"Date"`, `"Set"`, `"Map"`, `"File"`, or
 * `"ClassInstance"`) when one is detected, or `null` for plain objects,
 * arrays, primitives, and `null`/`undefined`.
 *
 * The `File` check is SSR-safe: if the runtime has no `File` global the
 * branch is skipped without throwing.
 *
 * The `ClassInstance` check fires for any object whose prototype is not
 * `Object.prototype` and which is not an array — e.g. instances of user
 * classes whose mutations bypass reactivity.
 *
 * @internal
 */
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
  // Plain objects and arrays are JSON-friendly.
  if (Array.isArray(value)) {
    return null;
  }
  // Class instances: prototype is not Object.prototype.
  // Plain `{}` literals have prototype `Object.prototype`; objects created
  // via `Object.create(null)` have a `null` prototype which we treat as
  // "plain" (it's still JSON-roundtrippable).
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    return "ClassInstance";
  }

  return null;
}

/**
 * Per-(path, valueType) dedupe cache — once a warning fires for a given
 * combo we never re-emit. Keeps the dev console quiet under loops that
 * assign the same Date 100 times in a row.
 *
 * @internal
 */
const nonJsonWarningCache = new Set<string>();

const nonJsonHints: Record<string, string> = {
  Date: ".getTime() for timestamps",
  Set: "[...set] for arrays",
  Map: "Object.fromEntries(map) for plain objects",
  File: "{ name, size, type, lastModified } for metadata",
  ClassInstance: "a plain-object snapshot",
};

/**
 * Emit a one-time dev-mode warning when a non-JSON value is assigned to a
 * fact. Called from the proxy `set` traps in both `createFactsProxy`
 * (single-module / standalone facts) and `createModuleFactsProxy`
 * (system-namespaced facts). No-ops in production builds — the call sites
 * are gated on `isDevelopment` so this entire helper is tree-shakable.
 *
 * @param factPath - Display path for the warning (e.g. `auth.token` or
 *   bare `token` for non-namespaced stores).
 * @param valueType - The label returned from {@link detectNonJsonValueType}.
 *
 * @internal
 */
export function warnNonJsonFactAssignment(
  factPath: string,
  valueType: string,
): void {
  const cacheKey = `${factPath}|${valueType}`;
  if (nonJsonWarningCache.has(cacheKey)) {
    return;
  }
  nonJsonWarningCache.add(cacheKey);

  const hint = nonJsonHints[valueType] ?? "a JSON-roundtrippable value";
  console.warn(
    `[Directive] Fact "${factPath}" assigned a ${valueType} instance.\n` +
      `Facts must be JSON-roundtrippable for reactivity to work correctly.\n` +
      `${valueType} mutations are not tracked.\n` +
      `Use ${hint} instead.\n` +
      `See: https://directive.run/docs/facts#json-rule`,
  );
}

/**
 * Reset the warning dedupe cache. Test-only — exported via internals for
 * vitest spec setup. Not part of the public API.
 *
 * @internal
 */
export function _resetNonJsonWarningCache(): void {
  nonJsonWarningCache.clear();
}
