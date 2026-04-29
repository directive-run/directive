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
 * The snapshot uses {@link structuredClone} (Node 17+, modern
 * browsers — Directive's documented engine baseline). On clone
 * failure (function, DOM node, non-cloneable shape), throws a typed
 * {@link OptimisticCloneError} with the offending key — the loud-fail
 * contract means rollback never silently mis-restores. Convert at the
 * boundary (e.g. `Date → number`, `BigInt → string`) before assigning
 * to facts.
 */
export function createSnapshot<F extends Record<string, unknown>, K extends keyof F>(
  facts: F,
  keys: readonly K[],
): () => void {
  // Atomic capture: build the snapshot into a local first; only after
  // every key clones successfully do we expose the restore closure.
  // If any single clone throws, the partial snapshot is discarded and
  // the throw propagates — the caller never gets a restore() that
  // would overwrite un-snapshotted facts with `undefined`. (R2 sec
  // C-R2-2.)
  const snapshot = {} as Pick<F, K>;
  for (const key of keys) {
    snapshot[key] = clone(facts[key], key) as F[K];
  }
  // Freeze the captured key list so the restore closure cannot be
  // tricked by mutating the input array post-construction.
  const capturedKeys: readonly K[] = [...keys];
  return () => {
    for (const key of capturedKeys) {
      facts[key] = clone(snapshot[key], key) as F[K];
    }
  };
}

/**
 * Higher-order helper that wraps a mutation handler with snapshot +
 * automatic rollback on throw. The handler keeps its full ctx; on
 * uncaught throw, the listed keys are restored to their pre-handler
 * values, then the throw propagates.
 *
 * **Two-arg form (recommended for inference):**
 *
 * ```ts
 * import { defineMutator } from '@directive-run/mutator';
 * import { withOptimistic } from '@directive-run/optimistic';
 *
 * const mut = defineMutator<FormMutations, FormFacts>({
 *   submit: withOptimistic<FormFacts>(['values'])(async ({ payload, facts }) => {
 *     facts.values = optimisticGuess(payload);
 *     facts.values = await deps.submit(payload); // throws on network err
 *   }),
 * });
 * ```
 *
 * The curried form lets TypeScript infer the handler's payload + ctx
 * shape without you spelling out `<F, K, Ctx>` explicitly. The keys
 * array is type-checked against `keyof F` — typos like `'valuess'`
 * become compile errors.
 *
 * On uncaught throw:
 *   1. The listed keys are restored from the pre-handler snapshot.
 *   2. The throw propagates upward (the mutator captures it on
 *      `pendingMutation.error`).
 */
export function withOptimistic<F extends Record<string, unknown>>(
  keys: readonly (keyof F)[],
): <Ctx extends { facts: F }>(
  handler: (ctx: Ctx) => Promise<void> | void,
) => (ctx: Ctx) => Promise<void> {
  return <Ctx extends { facts: F }>(
    handler: (ctx: Ctx) => Promise<void> | void,
  ) => {
    return async (ctx: Ctx) => {
      const restore = createSnapshot(ctx.facts, keys);
      try {
        await handler(ctx);
      } catch (err) {
        restore();
        throw err;
      }
    };
  };
}

/**
 * Thrown when a fact value cannot be cloned for snapshotting. This
 * surfaces as a real error rather than a silent corruption — Directive's
 * fact contract is JSON-roundtrippable, and shapes outside that contract
 * (functions, DOM nodes, BigInt, circular refs, class instances with
 * non-cloneable properties) cannot be safely snapshotted.
 */
export class OptimisticCloneError extends Error {
  override readonly name = "OptimisticCloneError";
  constructor(public readonly key: PropertyKey, cause?: unknown) {
    super(
      `[optimistic] Failed to snapshot fact key "${String(key)}": value is not JSON-roundtrippable. ` +
        `Convert at the boundary (e.g. Date → number, Set/Map → array/object, BigInt → string) before assigning to facts.`,
    );
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Structural clone matching Directive's JSON-roundtrip fact contract.
 *
 * Uses {@link structuredClone} (Node 17+, modern browsers — Directive's
 * documented engine baseline). NO JSON-roundtrip fallback: the JSON
 * path silently drops functions, symbols, and undefined values, which
 * is exactly the silent corruption optimistic rollback exists to
 * prevent. If `structuredClone` throws (function, DOM node, non-cloneable
 * shape), we re-throw a typed {@link OptimisticCloneError} so the
 * caller sees a loud failure with the offending key.
 *
 * @internal
 */
function clone<T>(value: T, key: PropertyKey): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (typeof structuredClone !== "function") {
    throw new OptimisticCloneError(
      key,
      new Error(
        "structuredClone is required (Node 17+ / modern browsers). " +
          "Polyfill structuredClone or upgrade your runtime.",
      ),
    );
  }
  try {
    return structuredClone(value);
  } catch (cause) {
    throw new OptimisticCloneError(key, cause);
  }
}
