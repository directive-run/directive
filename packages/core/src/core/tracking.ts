/**
 * Dependency tracking context for auto-tracking derivations
 *
 * Uses a stack-based approach to handle nested derivation computations.
 * When a derivation accesses a fact, the tracking context records it.
 */

/**
 * What kind of body is on the tracking stack.
 *
 * The distinction exists because a derivation read means two different things
 * depending on who is reading. A derivation body reading another derivation is
 * an *internal edge* — the derivation graph already knows how to invalidate
 * along it. A constraint or an effect reading one is an *external observer*,
 * and the derivations manager has to record that something outside the graph is
 * watching, or that reader is never woken when the value moves.
 *
 * Carried on the frame rather than in a parallel counter. A counter lives in one
 * module while the stack lives in another, so the two have to be kept in
 * agreement by hand — and they were not: one of the two doors onto a derivation
 * consulted the counter and the other did not. This is how the reactive
 * literature does it too. MobX hangs the current `IDerivation` off global state
 * and distinguishes `ComputedValue` from `Reaction` by class; Solid's `Listener`
 * holds a `Computation` with a `pure` flag; Adapton distinguishes edges by the
 * articulation point that demanded them. In none of them is the answer a
 * recursion depth.
 */
export type TrackingKind = "derivation" | "observer";

interface TrackingFrame {
  deps: Set<string>;
  kind: TrackingKind;
}

/** Stack of active tracking frames. */
const depStack: TrackingFrame[] = [];

/**
 * Get the current dependency set, or null if not tracking.
 *
 * @returns The active dependency Set, or `null` if no tracking is active.
 *
 * @internal
 */
export function getCurrentDeps(): Set<string> | null {
  const len = depStack.length;
  return len === 0 ? null : depStack[len - 1]!.deps;
}

/**
 * What kind of body is currently tracking, or `null` if none is.
 *
 * `"observer"` is the answer that makes a derivation read register a watcher.
 * Read it rather than inferring the same thing from a depth or a flag — there
 * is one stack, and this is the only question worth asking of it.
 *
 * @internal
 */
export function currentTrackingKind(): TrackingKind | null {
  const len = depStack.length;

  return len === 0 ? null : depStack[len - 1]!.kind;
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
export function withTracking<T>(
  fn: () => T,
  kind: TrackingKind = "observer",
): { value: T; deps: Set<string> } {
  const deps = new Set<string>();
  depStack.push({ deps, kind });

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
  depStack[len - 1]!.deps.add(key);
}

// ============================================================================
// Derivation namespace
// ============================================================================

/**
 * The prefix that separates a derivation ID from a fact key inside a dependency
 * set.
 *
 * A tracked dependency set is one flat `Set<string>`, and it carries both kinds
 * of name: a body that reads `facts.ready` records `"ready"`, and a body that
 * reads `derived.ready` or `system.derive.ready` records the derivation. Without
 * a namespace those are the same string, so a module declaring a fact and a
 * derivation with the same name — legal today, and harmless in every other
 * respect — made the dependency lookup return the union of the two. A constraint
 * gated on the fact re-evaluated when the derivation went stale, and an effect
 * gated on the fact re-ran.
 *
 * The character is `US` (unit separator, `U+001F`), not a readable prefix like
 * `"derive:"`. Fact keys are arbitrary strings — `t.object()` under a key of any
 * shape is valid — so a readable prefix is only *unlikely* to collide, and this
 * whole namespace exists because "unlikely" was not good enough the first time.
 * Every place a namespaced name reaches a human it is unwrapped first (see
 * {@link describeDep}).
 *
 * A control character is unusual in a property name but not impossible: a
 * bracketed access with a unicode escape is ordinary TypeScript, and a schema
 * key can be computed rather than written. A fact key beginning with the
 * separator is byte-identical to the recorded form of the same-named
 * derivation, which is the original collision one character to the right. So
 * the namespace is injective by enforcement rather than by luck —
 * `createModule` rejects a fact key or derivation ID carrying this character.
 * See `validateDepNamespaceKeys` in `module.ts`.
 *
 * @internal
 */
export const DERIVATION_DEP_PREFIX = "\u001F";

/**
 * The dependency-set name for a derivation ID.
 *
 * @internal
 */
export function derivationDep(id: string): string {
  return DERIVATION_DEP_PREFIX + id;
}

/**
 * Whether a dependency-set name refers to a derivation rather than a fact.
 *
 * @internal
 */
export function isDerivationDep(dep: string): boolean {
  return dep.charCodeAt(0) === 0x1f;
}

/**
 * The derivation ID inside a namespaced dependency name.
 *
 * Returns `dep` unchanged when it is a fact key, so callers that just want a
 * name can use it unconditionally.
 *
 * @internal
 */
export function derivationDepId(dep: string): string {
  return isDerivationDep(dep) ? dep.slice(1) : dep;
}

/**
 * A dependency name as a human should read it.
 *
 * Facts keep their key. Derivations are rendered `derive.total`, which is how
 * they are read in source, so a trace or an `explain()` line never shows the
 * separator.
 *
 * @internal
 */
export function describeDep(dep: string): string {
  return isDerivationDep(dep) ? `derive.${dep.slice(1)}` : dep;
}

/**
 * A declared `deps` array, translated into the names an invalidation set uses.
 *
 * Auto-tracking writes derivation dependencies under {@link derivationDep};
 * `deps` is written by hand and arrives as bare names, so the two sides of the
 * comparison have to be brought onto one keyspace or the hand-written half
 * matches nothing. That is not a hypothetical: `deps: ["doubled"]` naming a
 * derivation recorded `"doubled"`, the invalidation set carried the namespaced
 * form, the effect never re-ran — and an async constraint, which cannot
 * auto-track at all, has `deps` as its only way to say what it reads.
 *
 * `isDerivation` decides per name, and is asked rather than assumed because
 * only the engine knows what the merged module set declares. A name it does not
 * claim stays exactly as written, so a fact key is untouched.
 *
 * @param deps - Names as the caller wrote them.
 * @param isDerivation - Whether a name refers to a derivation. A name that is
 *   both a fact key and a derivation ID is expected to answer `false`: `deps`
 *   has always meant fact keys, and the engine already warns on the collision.
 *
 * @internal
 */
export function normalizeExplicitDeps(
  deps: readonly string[],
  isDerivation: (name: string) => boolean,
): Set<string> {
  const resolved = new Set<string>();
  for (const dep of deps) {
    resolved.add(isDerivation(dep) ? derivationDep(dep) : dep);
  }

  return resolved;
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
/**
 * Bound the dev-mode warning cache so a long-running process with many
 * distinct fact paths (per-tenant, per-request-correlation, etc.) doesn't
 * grow the Set indefinitely. FIFO eviction means warnings re-fire after
 * eviction — that's actually more useful than silent suppression, since
 * the consumer hasn't actually fixed the underlying non-JSON assignment.
 */
const NON_JSON_WARNING_CACHE_MAX = 1000;
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
  if (nonJsonWarningCache.size >= NON_JSON_WARNING_CACHE_MAX) {
    const oldest = nonJsonWarningCache.values().next().value;
    if (oldest !== undefined) {
      nonJsonWarningCache.delete(oldest);
    }
  }
  nonJsonWarningCache.add(cacheKey);

  const hint = nonJsonHints[valueType] ?? "a JSON-roundtrippable value";
  console.warn(
    `[Directive] Fact "${factPath}" assigned a ${valueType} instance.\nFacts must be JSON-roundtrippable for reactivity to work correctly.\n${valueType} mutations are not tracked.\nUse ${hint} instead.\nSee: https://directive.run/docs/facts#json-rule`,
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
