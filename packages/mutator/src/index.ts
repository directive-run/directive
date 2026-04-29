/**
 * @directive-run/mutator
 *
 * Discriminated mutation helper. Collapses the manual `pendingAction`
 * ceremony — fact + event + constraint + resolver — into a typed handler
 * map.
 *
 * Background: across the 55-cycle Minglingo migration, 12 modules ended
 * up with the same shape:
 *   - a nullable `pendingAction` fact holding a discriminated union
 *   - an event that sets it
 *   - a constraint that fires on non-null
 *   - a resolver that switches on the discriminator and clears the fact
 *
 * That's ~50 lines of boilerplate per module times 12 modules. The
 * `defineMutator` helper below contributes all four pieces from a single
 * typed declaration, so a module that uses it spreads the fragments
 * into its `createModule` config and writes only the per-variant handler
 * bodies.
 *
 * @see ../README.md for the full API and a worked example.
 */

import { t } from "@directive-run/core";

/**
 * A keyed map of variant payloads. Each key becomes a discriminator value
 * for the mutation, each value is the payload type for that variant.
 *
 * @example
 * ```ts
 * type MyMutations = {
 *   submit: { values: FormValues };
 *   cancel: {};
 *   retry: { reason: string };
 * };
 * ```
 */
export type MutationMap = Record<string, Record<string, unknown>>;

/**
 * The shape of a `pendingMutation` fact while a mutation is queued or
 * running.
 */
export type PendingMutation<M extends MutationMap> = {
  [K in keyof M]: {
    kind: K;
    payload: M[K];
    /**
     * `pending` — queued, constraint hasn't fired yet
     * `running` — handler is in flight
     */
    status: "pending" | "running";
    /** Error from the previous run, if any. Cleared on next dispatch. */
    error: string | null;
  };
}[keyof M];

/**
 * Handler context passed to each variant handler.
 *
 * Note: `deps` is NOT in the context. This matches the Directive resolver
 * idiom — close over deps from the outer module-factory scope:
 *
 * ```ts
 * function createFormModule(deps: FormDeps) {
 *   const mut = defineMutator<FormMutations, FormFacts>({
 *     submit: async ({ payload, facts }) => {
 *       facts.values = await deps.submit(payload.values); // ← closure
 *     },
 *   });
 *   return createModule('form', { ... });
 * }
 * ```
 */
export interface MutatorHandlerContext<F> {
  /** Live facts proxy. Reads are cache-tracked; writes invalidate. */
  facts: F;
  /**
   * Trigger a same-constraint re-fire after this handler returns. Useful
   * when one mutation cascades into another — without `requeue`, the next
   * mutation would stall behind same-flush suppression.
   *
   * @see https://docs.directive.run/testing/chained-pipelines
   */
  requeue: () => void;
}

/**
 * Variant handler body. Receives the typed payload + a context; returns
 * void or a Promise. Throwing is fine — the runtime captures into
 * `pendingMutation.error` before clearing the fact.
 */
export type MutationHandler<
  M extends MutationMap,
  K extends keyof M,
  F,
> = keyof M[K] extends never
  ? (ctx: MutatorHandlerContext<F>) => void | Promise<void>
  : (
      ctx: MutatorHandlerContext<F> & { payload: M[K] },
    ) => void | Promise<void>;

/**
 * The full handler map. Every variant in `M` MUST have a handler.
 */
export type MutationHandlers<M extends MutationMap, F> = {
  [K in keyof M]: MutationHandler<M, K, F>;
};

/**
 * The fragments returned by `defineMutator`. Spread each fragment into
 * the matching position of your `createModule` config.
 *
 * @internal Shape documented for type clarity; users typically just
 * spread.
 */
export interface MutatorFragments<M extends MutationMap, F> {
  /** Spread into `schema.facts`. Adds `pendingMutation`. */
  facts: {
    pendingMutation: ReturnType<typeof t.object>;
  };
  /** Spread into `schema.events`. Adds the `MUTATE` event. */
  events: {
    MUTATE: PendingMutation<M>;
  };
  /** Spread into `schema.requirements`. Adds `PROCESS_MUTATION`. */
  requirements: {
    PROCESS_MUTATION: Record<string, never>;
  };
  /** Spread into the `events` field. Sets pendingMutation on MUTATE. */
  eventHandlers: {
    MUTATE: (facts: F, payload: PendingMutation<M>) => void;
  };
  /** Spread into the `constraints` field. */
  constraints: {
    pendingMutation: {
      when: (facts: F) => boolean;
      require: { type: "PROCESS_MUTATION" };
    };
  };
  /** Spread into the `resolvers` field. */
  resolvers: {
    mutationResolver: {
      requirement: "PROCESS_MUTATION";
      resolve: (
        req: { type: "PROCESS_MUTATION" },
        ctx: { facts: F },
      ) => Promise<void>;
    };
  };
  /**
   * Convenience: the initial value for `pendingMutation`. Set this in
   * your module's `init` if you don't use `t.X().default(...)` defaults.
   */
  initialPendingMutation: null;
}

/**
 * Define a mutator fragment-set for a given variant map and handlers.
 *
 * @example
 * ```ts
 * type FormMutations = {
 *   submit: { values: FormValues };
 *   cancel: {};
 * };
 *
 * const formMutator = defineMutator<FormMutations, FormDeps>({
 *   submit: async ({ payload, facts, deps }) => {
 *     facts.values = await deps.submit(payload.values);
 *   },
 *   cancel: ({ facts }) => { facts.values = []; },
 * });
 *
 * createModule('form', {
 *   schema: {
 *     facts: { ...formMutator.facts, values: t.array<FormValues>() },
 *     events: { ...formMutator.events, REFRESH: {} },
 *     requirements: { ...formMutator.requirements },
 *   },
 *   init: (f) => { f.pendingMutation = null; f.values = []; },
 *   events: {
 *     ...formMutator.eventHandlers,
 *     REFRESH: (f) => { f.values = []; },
 *   },
 *   constraints: { ...formMutator.constraints },
 *   resolvers: { ...formMutator.resolvers },
 * });
 *
 * // Usage:
 * sys.events.MUTATE({
 *   type: 'submit',
 *   payload: { values: ... },
 *   status: 'pending',
 *   error: null,
 * });
 * ```
 *
 * The handler-bound deps are captured at `defineMutator` call time. To
 * inject deps from the caller, wrap `defineMutator` in your module
 * factory:
 *
 * ```ts
 * export function createFormModule(deps: FormDeps) {
 *   const mut = defineMutator<FormMutations, FormDeps>({
 *     submit: async ({ payload, facts }) => {
 *       facts.values = await deps.submit(payload.values);
 *     },
 *     cancel: ({ facts }) => { facts.values = []; },
 *   });
 *   return createModule('form', { ... });
 * }
 * ```
 */
export function defineMutator<
  M extends MutationMap,
  F = Record<string, unknown>,
>(handlers: MutationHandlers<M, F>): MutatorFragments<M, F> {
  type Pending = PendingMutation<M>;

  const facts = {
    pendingMutation: t.object<Pending>().nullable() as ReturnType<
      typeof t.object
    >,
  } as MutatorFragments<M, F>["facts"];

  // Schema event marker — the runtime uses this for typing and devtools.
  // Payload validation happens at dispatch time via t-schema check.
  const events = {
    MUTATE: undefined as unknown as Pending,
  } as MutatorFragments<M, F>["events"];

  const requirements = {
    PROCESS_MUTATION: {} as Record<string, never>,
  } as MutatorFragments<M, F>["requirements"];

  const eventHandlers = {
    MUTATE: (facts: F, payload: Pending) => {
      // Overwrite is intentional — caller is responsible for ordering.
      // If a previous mutation is mid-flight, the new one queues by
      // overwriting; the in-flight handler will null the fact when it
      // completes, then the constraint re-fires for the new one.
      // (Same as the manual pattern across all 12 audited modules.)
      (facts as { pendingMutation: Pending | null }).pendingMutation = {
        ...payload,
        status: "pending",
        error: null,
      };
    },
  } as MutatorFragments<M, F>["eventHandlers"];

  const constraints = {
    pendingMutation: {
      when: (facts: F) =>
        (facts as { pendingMutation: Pending | null }).pendingMutation !==
          null &&
        (facts as { pendingMutation: Pending | null }).pendingMutation
          ?.status === "pending",
      require: { type: "PROCESS_MUTATION" } as const,
    },
  } as MutatorFragments<M, F>["constraints"];

  const resolvers = {
    mutationResolver: {
      requirement: "PROCESS_MUTATION" as const,
      resolve: async (
        _req: { type: "PROCESS_MUTATION" },
        ctx: {
          facts: F;
          requeue?: () => void;
        },
      ) => {
        const factsRef = ctx.facts as { pendingMutation: Pending | null };
        const pending = factsRef.pendingMutation;
        if (pending === null) return;

        // Mark in-flight so concurrent constraint evaluations don't double-fire.
        factsRef.pendingMutation = { ...pending, status: "running" };

        const handler = (handlers as Record<string, unknown>)[
          pending.kind as string
        ];
        if (typeof handler !== "function") {
          factsRef.pendingMutation = {
            ...pending,
            status: "pending",
            error: `[mutator] no handler registered for variant: ${String(
              pending.kind,
            )}`,
          };
          return;
        }

        const handlerCtx = {
          facts: ctx.facts,
          payload: pending.payload,
          requeue: ctx.requeue ?? (() => {}),
        };

        try {
          await (handler as (c: typeof handlerCtx) => Promise<void> | void)(
            handlerCtx,
          );
          // Success: clear the fact so the constraint stops firing.
          factsRef.pendingMutation = null;
        } catch (err) {
          // Failure: surface the error on the fact, leave status='running'
          // so the constraint stops firing. Caller may dispatch a new
          // MUTATE to retry.
          factsRef.pendingMutation = {
            ...pending,
            status: "running",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    },
  } as MutatorFragments<M, F>["resolvers"];

  return {
    facts,
    events,
    requirements,
    eventHandlers,
    constraints,
    resolvers,
    initialPendingMutation: null,
  };
}

/**
 * Helper for typed dispatch. Lets the caller construct a mutation payload
 * with full type narrowing — the `type` field auto-restricts the
 * `payload` shape.
 *
 * @example
 * ```ts
 * sys.events.MUTATE(mutate<FormMutations>('submit', { values: ... }));
 * sys.events.MUTATE(mutate<FormMutations>('cancel'));
 * ```
 */
export function mutate<M extends MutationMap, K extends keyof M & string>(
  kind: K,
  payload: M[K],
): PendingMutation<M>;
export function mutate<M extends MutationMap, K extends keyof M & string>(
  kind: K,
): PendingMutation<M>;
export function mutate<M extends MutationMap, K extends keyof M & string>(
  kind: K,
  payload?: M[K],
): PendingMutation<M> {
  return {
    kind,
    payload: (payload ?? {}) as M[K],
    status: "pending",
    error: null,
  } as PendingMutation<M>;
}
