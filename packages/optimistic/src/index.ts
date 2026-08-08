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
 * recurred ~3 times in a production migration, refactored into a
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
export function createSnapshot<
  F extends Record<string, unknown>,
  K extends keyof F,
>(facts: F, keys: readonly K[]): () => void {
  // Atomic capture: build the snapshot into a local first; only after
  // every key clones successfully do we expose the restore closure.
  // If any single clone throws, the partial snapshot is discarded and
  // the throw propagates — the caller never gets a restore() that
  // would overwrite un-snapshotted facts with `undefined`.
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
 * Wrap every handler in a `defineMutator`-style handler map with
 * automatic rollback on throw, declaring the rollback keys per handler
 * instead of repeating `withOptimistic` at every callsite.
 *
 * The keys map is partial: any handler not listed is passed through
 * unwrapped. Each listed handler is wrapped with `withOptimistic(keys)`
 * – the snapshot is captured at handler entry, restored on throw, and
 * the throw still propagates so the mutator captures it on
 * `pendingMutation.error` for the UI.
 *
 * @param keys - Per-handler rollback key arrays. Omit a handler to skip wrapping.
 * @param handlers - The original handler map (matches the shape returned to `defineMutator`).
 * @returns A new handler map with the same shape; listed entries are wrapped.
 *
 * @example
 * ```ts
 * import { defineMutator } from "@directive-run/mutator";
 * import { withOptimisticHandlers } from "@directive-run/optimistic";
 *
 * type Muts = {
 *   saveDraft: { text: string };
 *   publish: void;
 * };
 *
 * const handlers = withOptimisticHandlers<typeof handlersRaw, Facts>(
 *   {
 *     // saveDraft optimistically writes `draft` then awaits the server;
 *     // on throw the prior `draft` value is restored.
 *     saveDraft: ["draft"],
 *     // publish flips `draft` → `published`, both need restoring on failure.
 *     publish: ["draft", "published"],
 *   },
 *   handlersRaw,
 * );
 *
 * const mut = defineMutator<Muts, Facts>(handlers);
 * ```
 *
 * Layering note: wrap with `withOptimisticHandlers` BEFORE wrapping
 * the result with `cancellable()` so a supersede-abort doesn't trip
 * the rollback. See the README's "Layering with cancellable()" section.
 */
export function withOptimisticHandlers<
  H extends Record<string, (ctx: any) => Promise<void> | void>,
  F extends Record<string, unknown>,
>(keys: { [K in keyof H]?: readonly (keyof F)[] }, handlers: H): H {
  const wrapped: Record<string, H[keyof H]> = {};
  for (const handlerName of Object.keys(handlers) as Array<keyof H>) {
    const handler = handlers[handlerName];
    const rollbackKeys = keys[handlerName];
    if (!rollbackKeys || rollbackKeys.length === 0) {
      wrapped[handlerName as string] = handler;
      continue;
    }

    const wrap = withOptimistic<F>(rollbackKeys);
    // Cast preserves the original handler's signature; the structural
    // bound on H is "function taking a ctx with facts: F", which is the
    // contract `withOptimistic` requires.
    wrapped[handlerName as string] = wrap(
      handler as unknown as (ctx: { facts: F }) => Promise<void> | void,
    ) as H[keyof H];
  }

  return wrapped as unknown as H;
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
  constructor(
    public readonly key: PropertyKey,
    cause?: unknown,
  ) {
    super(
      `[optimistic] Failed to snapshot fact key "${String(key)}": value is not JSON-roundtrippable. Convert at the boundary (e.g. Date → number, Set/Map → array/object, BigInt → string) before assigning to facts.`,
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
