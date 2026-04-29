/**
 * @directive-run/optimistic
 *
 * Resolver-scope optimistic update + automatic rollback. Snapshot specific
 * facts at the start of a handler; if the handler throws, the snapshot
 * restores them before the throw propagates.
 *
 * **Scope is intentional and tight.** This package operates within a
 * single resolver/handler invocation. It is NOT a system-wide
 * transaction primitive, NOT a replay-undo, and does NOT cross module
 * boundaries. Treat it as the "try / restore on catch" pattern that
 * recurred ~3 times in the Minglingo migration, refactored into a
 * one-line helper.
 *
 * @see ../README.md for the full API and a worked example.
 */

/**
 * Capture the current value of selected fact keys. Returns a `restore`
 * function that, when called, writes them back. Use inside a try/catch
 * (or the `withOptimistic` HOC below) to roll back on error.
 *
 * @param facts - The reactive facts proxy (whatever the handler ctx
 * received).
 * @param keys - The fact keys to snapshot.
 *
 * @example
 * ```ts
 * submit: async ({ payload, facts }) => {
 *   const restore = createSnapshot(facts, ['values', 'lastSavedAt']);
 *   try {
 *     facts.values = optimisticGuess(payload);
 *     facts.values = await deps.submit(payload);
 *     facts.lastSavedAt = Date.now();
 *   } catch (err) {
 *     restore();
 *     throw err;
 *   }
 * }
 * ```
 *
 * The snapshot uses structural cloning (`structuredClone` in modern
 * runtimes, JSON-roundtrip fallback elsewhere). This matches Directive's
 * JSON-roundtrippable-fact contract — if your fact violates that
 * contract, the snapshot will silently mis-restore. See
 * `@directive-run/core@1.2.0`'s dev-mode JSON-fact warning.
 */
export function createSnapshot<F extends Record<string, unknown>, K extends keyof F>(
  facts: F,
  keys: readonly K[],
): () => void {
  const snapshot = {} as Pick<F, K>;
  for (const key of keys) {
    snapshot[key] = clone(facts[key]) as F[K];
  }
  return () => {
    for (const key of keys) {
      facts[key] = clone(snapshot[key]) as F[K];
    }
  };
}

/**
 * Higher-order helper that wraps a mutation handler with snapshot +
 * automatic rollback on throw. The handler keeps its full ctx; on
 * uncaught throw, the listed keys are restored to their pre-handler
 * values, then the throw propagates.
 *
 * Designed to compose with `@directive-run/mutator`'s handler shape, but
 * works with any async function that takes a context object containing
 * `facts`.
 *
 * @example
 * ```ts
 * import { defineMutator } from '@directive-run/mutator';
 * import { withOptimistic } from '@directive-run/optimistic';
 *
 * const mut = defineMutator<FormMutations, FormFacts>({
 *   submit: withOptimistic(['values'], async ({ payload, facts }) => {
 *     facts.values = optimisticGuess(payload);
 *     facts.values = await deps.submit(payload); // throws on network err
 *   }),
 *   cancel: ({ facts }) => { facts.values = []; },
 * });
 * ```
 *
 * If the inner handler throws:
 *   1. `facts.values` is restored from the snapshot.
 *   2. The throw propagates upward (the mutator captures it on
 *      `pendingMutation.error`).
 */
export function withOptimistic<
  F extends Record<string, unknown>,
  K extends keyof F,
  Ctx extends { facts: F },
>(
  keys: readonly K[],
  handler: (ctx: Ctx) => Promise<void> | void,
): (ctx: Ctx) => Promise<void> {
  return async (ctx: Ctx) => {
    const restore = createSnapshot(ctx.facts, keys);
    try {
      await handler(ctx);
    } catch (err) {
      restore();
      throw err;
    }
  };
}

/**
 * Best-effort structural clone. Uses `structuredClone` when available
 * (Node 17+, modern browsers); falls back to JSON roundtrip otherwise.
 *
 * @internal
 */
function clone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // structuredClone may throw on non-cloneable shapes (functions, DOM
      // nodes, etc.). Fall through to JSON roundtrip.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
