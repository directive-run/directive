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
